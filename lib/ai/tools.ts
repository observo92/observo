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

async function fetchSlotRows(feature: Feature, dayOfWeek: number, hourOfDay: number): Promise<RawRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("raw_snapshots")
    .select("source, snapshot_date, volume_usd, deploy_count")
    .eq("feature", feature)
    .eq("day_of_week", dayOfWeek)
    .eq("hour_of_day", hourOfDay);
  if (error) throw new Error(`fetchSlotRows: ${error.message}`);
  return (data ?? []) as RawRow[];
}

// TODAY'S ACTUAL — what really happened on the most recent calendar date
// this slot was observed (i.e. this week's occurrence, not an average).
// This is the number the score and reasoning should be based on: users
// expect a "timing heatmap" to reflect real, verifiable activity for this
// specific hour, not a smoothed multi-week average. A verifiable, real
// number also matches the product's signature/verify feature — averages
// can't be pointed back to one real moment in the same way.
export async function getTodayStats(feature: Feature, dayOfWeek: number, hourOfDay: number) {
  const rows = await fetchSlotRows(feature, dayOfWeek, hourOfDay);
  if (rows.length === 0) {
    return { snapshotDate: null, total: 0, bySource: {} };
  }
  const latestDate = rows.reduce((max, r) => (r.snapshot_date > max ? r.snapshot_date : max), rows[0].snapshot_date);
  const todayRows = rows.filter((r) => r.snapshot_date === latestDate);

  const bySource: Record<string, number> = {};
  let total = 0;
  for (const row of todayRows) {
    const v = metricValue(row, feature);
    total += v;
    bySource[row.source] = (bySource[row.source] ?? 0) + v;
  }

  return { snapshotDate: latestDate, total, bySource };
}

// HISTORICAL AVERAGE — the typical amount for this slot, averaged across
// every distinct calendar day collected so far. This is NOT what the score
// should be based on (see getTodayStats) — it exists only as supporting
// context (e.g. "is today higher or lower than usual for this hour?") and
// to feed getSampleConfidence's distinct-day count.
export async function getHistoricalAverage(feature: Feature, dayOfWeek: number, hourOfDay: number) {
  const rows = await fetchSlotRows(feature, dayOfWeek, hourOfDay);
  if (rows.length === 0) {
    return { distinctDaysObserved: 0, average: 0 };
  }
  const distinctDates = new Set<string>();
  let total = 0;
  for (const row of rows) {
    total += metricValue(row, feature);
    distinctDates.add(row.snapshot_date);
  }
  return {
    distinctDaysObserved: distinctDates.size,
    average: total / distinctDates.size,
  };
}

// VERIFY — how much historical evidence actually backs this slot. Directly
// feeds the AI's confidence rating: 1-2 days of data is not the same
// reliability as 4+ weeks.
export async function getSampleConfidence(feature: Feature, dayOfWeek: number, hourOfDay: number) {
  const rows = await fetchSlotRows(feature, dayOfWeek, hourOfDay);
  const distinctDates = new Set(rows.map((r) => r.snapshot_date));
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

// CROSS-CHECK — is TODAY's activity broad (multiple independent
// launchpads/dexes agree) or is it one outlier pool/launchpad skewing the
// whole slot? Based on today's actual numbers, not the historical
// aggregate, since that's what the score is judging.
export async function crossCheckSources(feature: Feature, dayOfWeek: number, hourOfDay: number) {
  const today = await getTodayStats(feature, dayOfWeek, hourOfDay);
  const sources = Object.entries(today.bySource).sort((a, b) => b[1] - a[1]);
  const topSource = sources[0];
  const topShare = topSource && today.total > 0 ? topSource[1] / today.total : 0;

  return {
    numberOfSourcesActive: sources.length,
    topSource: topSource ? topSource[0] : null,
    topSourceShareOfTotal: Math.round(topShare * 100) / 100,
    broadlyConfirmed: sources.length >= 2 && topShare < 0.8,
  };
}

// Context — where does this hour rank among all 24 hours on the same day
// of week? Uses historical averages (not today's single figure) since it's
// answering "which hours of this day tend to be busiest", a multi-week
// question by nature. Lets the AI say things like "this is the 3rd busiest
// hour on Fridays" instead of just a raw number with no reference point.
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

// ANCHOR SCORE — a precomputed, deterministic 0-10 score based on where
// today's actual number for this slot ranks (percentile) among all 168
// day/hour slots' most-recent values, for the same feature. This exists
// because letting the AI freely invent a 0-10 score from scratch causes it
// to cluster heavily around "safe-looking" values (observed empirically:
// 136/161 generated verdicts scored exactly 8, despite the underlying
// numbers spanning a 10x range) -- a known failure mode of small LLMs used
// as judges. The anchor gives the AI a mathematically precise, reproducible
// starting point; the AI is instructed to only adjust it by a small amount
// based on genuine qualitative signals (source diversity, confidence), and
// the caller (verdict.ts) additionally clamps the AI's final score to a
// tight range around this anchor so it can never drift far regardless of
// what the model does.
export async function getAnchorScore(
  feature: Feature,
  dayOfWeek: number,
  hourOfDay: number
): Promise<{ anchorScore: number; percentile: number; todayValue: number }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("raw_snapshots")
    .select("day_of_week, hour_of_day, snapshot_date, volume_usd, deploy_count")
    .eq("feature", feature);
  if (error) throw new Error(`getAnchorScore: ${error.message}`);

  type Row = RawRow & { day_of_week: number; hour_of_day: number };
  const rows = (data ?? []) as Row[];

  // Group by slot, keep only each slot's most recent date's value (mirrors
  // getTodayStats' definition of "today" for consistency).
  const slotLatest = new Map<string, { date: string; value: number }>();
  for (const row of rows) {
    const key = `${row.day_of_week}-${row.hour_of_day}`;
    const v = metricValue(row, feature);
    const existing = slotLatest.get(key);
    if (!existing || row.snapshot_date > existing.date) {
      slotLatest.set(key, { date: row.snapshot_date, value: v });
    } else if (row.snapshot_date === existing.date) {
      slotLatest.set(key, { date: row.snapshot_date, value: existing.value + v });
    }
  }

  const targetKey = `${dayOfWeek}-${hourOfDay}`;
  const targetEntry = slotLatest.get(targetKey);
  const todayValue = targetEntry?.value ?? 0;

  const values = Array.from(slotLatest.values()).map((e) => e.value).sort((a, b) => a - b);
  if (values.length === 0) {
    return { anchorScore: 5, percentile: 50, todayValue };
  }

  // Percentile rank: fraction of slots with a value <= this slot's value.
  let countBelowOrEqual = 0;
  for (const v of values) {
    if (v <= todayValue) countBelowOrEqual++;
  }
  const percentile = (countBelowOrEqual / values.length) * 100;
  const anchorScore = Math.min(10, Math.max(0, Math.round(percentile / 10)));

  return { anchorScore, percentile: Math.round(percentile * 10) / 10, todayValue };
}

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "get_today_stats",
      description:
        "Get what actually happened on the most recent day this hour-of-week slot was observed (the real, verifiable number for this specific hour), broken down by source. Always call this first — this is what your score and reasoning should be based on.",
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
      name: "get_historical_average",
      description:
        "Get the typical (average) amount for this slot across all past weeks observed. Use this only as context (e.g. to say whether today is higher or lower than usual) — never as the basis for the score itself.",
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
        "Check whether today's activity is confirmed across multiple independent sources (dexes/launchpads) or driven by a single outlier. A pattern confirmed by multiple sources is more trustworthy.",
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
        "Get how this hour ranks against all 24 hours of the same day of week (by historical average), for context (e.g. '3rd busiest hour of the day').",
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
    case "get_today_stats":
      return getTodayStats(feature, dayOfWeek, hourOfDay);
    case "get_historical_average":
      return getHistoricalAverage(feature, dayOfWeek, hourOfDay);
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
