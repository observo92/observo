// Tools the AI can call during its reasoning pass. Each one queries real
// data already sitting in raw_snapshots — no invented/mocked stats. The
// AI decides which of these to call and in what order before writing a
// final verdict; this file only implements what each tool actually does.

import { getSupabaseAdmin } from "../supabase";

export type Feature = "volume" | "launch";

interface RawRow {
  source: string;
  snapshot_date: string;
  volume_usd: number | null;
  deploy_count: number | null;
}

function metricValue(row: RawRow, feature: Feature): number {
  return feature === "volume" ? row.volume_usd ?? 0 : row.deploy_count ?? 0;
}

// SCAN — what actually happened, historically, in this exact hour-of-week
// slot. Aggregates across every calendar date collected so far.
export async function getCurrentHourStats(
  feature: Feature,
  dayOfWeek: number,
  hourOfDay: number
) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("raw_snapshots")
    .select("source, snapshot_date, volume_usd, deploy_count")
    .eq("feature", feature)
    .eq("day_of_week", dayOfWeek)
    .eq("hour_of_day", hourOfDay);

  if (error) throw new Error(`getCurrentHourStats: ${error.message}`);
  const rows = (data ?? []) as RawRow[];
  if (rows.length === 0) {
    return { sampleSize: 0, total: 0, average: 0, bySource: {} };
  }

  const bySource: Record<string, number> = {};
  let total = 0;
  const distinctDates = new Set<string>();
  for (const row of rows) {
    const v = metricValue(row, feature);
    total += v;
    bySource[row.source] = (bySource[row.source] ?? 0) + v;
    distinctDates.add(row.snapshot_date);
  }

  return {
    sampleSize: distinctDates.size,
    total,
    average: total / distinctDates.size,
    bySource,
  };
}

// VERIFY — how much historical evidence actually backs this slot. Directly
// feeds the AI's confidence rating: 1-2 days of data is not the same
// reliability as 4+ weeks.
export async function getSampleConfidence(
  feature: Feature,
  dayOfWeek: number,
  hourOfDay: number
) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("raw_snapshots")
    .select("snapshot_date")
    .eq("feature", feature)
    .eq("day_of_week", dayOfWeek)
    .eq("hour_of_day", hourOfDay);

  if (error) throw new Error(`getSampleConfidence: ${error.message}`);
  const distinctDates = new Set((data ?? []).map((r) => r.snapshot_date));
  return {
    distinctDaysObserved: distinctDates.size,
    recommendation:
      distinctDates.size >= 21
        ? "high"
        : distinctDates.size >= 7
        ? "medium"
        : "low",
  };
}

// CROSS-CHECK — is the pattern broad (multiple independent launchpads/dexes
// agree) or is it one outlier pool/launchpad skewing the whole slot? A
// verdict backed by 1 source is much weaker than one backed by 3.
export async function crossCheckSources(
  feature: Feature,
  dayOfWeek: number,
  hourOfDay: number
) {
  const stats = await getCurrentHourStats(feature, dayOfWeek, hourOfDay);
  const sources = Object.entries(stats.bySource).sort((a, b) => b[1] - a[1]);
  const topSource = sources[0];
  const topShare = topSource && stats.total > 0 ? topSource[1] / stats.total : 0;

  return {
    numberOfSourcesActive: sources.length,
    topSource: topSource ? topSource[0] : null,
    topSourceShareOfTotal: Math.round(topShare * 100) / 100,
    broadlyConfirmed: sources.length >= 2 && topShare < 0.8,
  };
}

// Context — where does this hour rank among all 24 hours on the same day
// of week? Lets the AI say things like "this is the 3rd busiest hour on
// Fridays" instead of just a raw number with no reference point.
export async function getHourlyPattern(feature: Feature, dayOfWeek: number) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("raw_snapshots")
    .select("hour_of_day, snapshot_date, volume_usd, deploy_count")
    .eq("feature", feature)
    .eq("day_of_week", dayOfWeek);

  if (error) throw new Error(`getHourlyPattern: ${error.message}`);
  const rows = (data ?? []) as (RawRow & { hour_of_day: number })[];

  const totals = new Map<number, number>();
  const dateCounts = new Map<number, Set<string>>();
  for (const row of rows) {
    const v = metricValue(row, feature);
    totals.set(row.hour_of_day, (totals.get(row.hour_of_day) ?? 0) + v);
    if (!dateCounts.has(row.hour_of_day)) dateCounts.set(row.hour_of_day, new Set());
    dateCounts.get(row.hour_of_day)!.add(row.snapshot_date);
  }

  const averages = Array.from(totals.entries()).map(([hour, total]) => ({
    hour,
    average: total / (dateCounts.get(hour)?.size || 1),
  }));
  averages.sort((a, b) => b.average - a.average);

  return {
    rankedHours: averages.map((a, i) => ({ hour: a.hour, average: Math.round(a.average), rank: i + 1 })),
  };
}

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "get_current_hour_stats",
      description:
        "Get the historical activity total/average for this exact hour-of-week slot, broken down by source (dex or launchpad). Always call this first.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_sample_confidence",
      description:
        "Check how many distinct calendar days of historical data back this slot. Use this to decide your confidence level — few days means low confidence even if the numbers look extreme.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cross_check_sources",
      description:
        "Check whether this hour's activity is confirmed across multiple independent sources (dexes/launchpads) or driven by a single outlier. A pattern confirmed by multiple sources is more trustworthy.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_hourly_pattern",
      description:
        "Get how this hour ranks against all 24 hours of the same day of week, for context (e.g. '3rd busiest hour of the day').",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

export async function callTool(
  name: string,
  feature: Feature,
  dayOfWeek: number,
  hourOfDay: number
): Promise<unknown> {
  switch (name) {
    case "get_current_hour_stats":
      return getCurrentHourStats(feature, dayOfWeek, hourOfDay);
    case "get_sample_confidence":
      return getSampleConfidence(feature, dayOfWeek, hourOfDay);
    case "cross_check_sources":
      return crossCheckSources(feature, dayOfWeek, hourOfDay);
    case "get_hourly_pattern":
      return getHourlyPattern(feature, dayOfWeek);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
