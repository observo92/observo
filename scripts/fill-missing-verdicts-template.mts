// Fills verdict slots that have never been generated, WITHOUT calling
// Groq — uses the exact same deterministic math as the AI path (anchor
// score percentile, sample confidence thresholds) plus a template sentence
// builder, so the heatmap has no visibly empty cells while the Groq TPD
// budget recovers. Every slot generated this way is fully re-generatable
// by the normal AI cron later on (same upsert key), so this is a safe,
// temporary stand-in, not a permanent divergence from the AI pipeline.
//
// Run with: npx tsx -r dotenv/config scripts/fill-missing-verdicts-template.mts dotenv_config_path=.env.local [--dry-run]

import { getSupabaseAdmin } from "../lib/supabase";
import { signPayload } from "../lib/signing";
import {
  getTodayStats,
  getHistoricalAverage,
  getSampleConfidence,
  crossCheckSources,
  getHourlyPattern,
  getAnchorScore,
  type Feature,
} from "../lib/ai/tools";
import type { Mode } from "../lib/ai/verdict";

const DRY_RUN = process.argv.includes("--dry-run");
const FEATURES: Feature[] = ["volume", "launch"];
const MODES: Mode[] = ["trader", "deployer"];

function fmtMoney(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 10e6 ? 1 : 2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function buildReasoning(
  feature: Feature,
  mode: Mode,
  todayValue: number,
  rank: number | null,
  totalRanked: number,
  confidence: "low" | "medium" | "high",
  broadlyConfirmed: boolean,
  topSourceShare: number,
  numberOfSourcesActive: number
): string {
  const unit = feature === "volume" ? "in volume" : "launches";
  const valueStr = feature === "volume" ? fmtMoney(todayValue) : `${Math.round(todayValue)}`;
  const subject = feature === "volume" ? "trading volume" : "launch activity";
  const audience = mode === "deployer" ? "This hour" : "This hour";

  const rankPhrase =
    rank != null && totalRanked > 0
      ? `, the ${ordinal(rank)} busiest hour of the day`
      : "";

  const activityPhrase =
    todayValue > 0
      ? `${audience} has seen around ${valueStr} ${unit}${rankPhrase}.`
      : `${audience} has seen little to no ${feature === "volume" ? "trading volume" : "launch activity"} so far.`;

  const confirmPhrase = broadlyConfirmed
    ? `The activity is confirmed across ${numberOfSourcesActive} independent sources.`
    : numberOfSourcesActive > 0
    ? `However, this is not confirmed across multiple sources — one source accounts for about ${Math.round(topSourceShare * 100)}% of the total.`
    : "";

  const confidencePhrase =
    confidence === "low"
      ? "This is still building a track record for this hour, so confidence in this reading is low."
      : confidence === "medium"
      ? "This slot now has a moderate track record, giving medium confidence in this reading."
      : "This slot has a solid track record, giving high confidence in this reading.";

  return [activityPhrase, confirmPhrase, confidencePhrase].filter(Boolean).join(" ");
}

interface Slot {
  feature: Feature;
  mode: Mode;
  dayOfWeek: number;
  hourOfDay: number;
}

async function fetchExistingSlots(): Promise<Set<string>> {
  const admin = getSupabaseAdmin();
  const existing = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await admin.from("verdicts").select("feature, mode, day_of_week, hour_of_day").range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data) existing.add(`${row.feature}|${row.mode}|${row.day_of_week}|${row.hour_of_day}`);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return existing;
}

async function main() {
  const existing = await fetchExistingSlots();
  const slots: Slot[] = [];
  for (const feature of FEATURES) {
    for (const mode of MODES) {
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          const key = `${feature}|${mode}|${d}|${h}`;
          if (!existing.has(key)) slots.push({ feature, mode, dayOfWeek: d, hourOfDay: h });
        }
      }
    }
  }

  console.log(`=== Filling ${slots.length} missing verdict slots (template-based, no AI) ===`);
  const admin = getSupabaseAdmin();
  let filled = 0;
  let skippedNoData = 0;

  // Cache getHourlyPattern per (feature, dayOfWeek) since it's the same for all hours of that day.
  const patternCache = new Map<string, Awaited<ReturnType<typeof getHourlyPattern>>>();

  for (const slot of slots) {
    const { feature, mode, dayOfWeek, hourOfDay } = slot;
    const [today, historical, confidenceInfo, crossCheck, anchor] = await Promise.all([
      getTodayStats(feature, dayOfWeek, hourOfDay),
      getHistoricalAverage(feature, dayOfWeek, hourOfDay),
      getSampleConfidence(feature, dayOfWeek, hourOfDay),
      crossCheckSources(feature, dayOfWeek, hourOfDay),
      getAnchorScore(feature, dayOfWeek, hourOfDay),
    ]);

    if (today.total === 0 && historical.average === 0) {
      skippedNoData++;
      continue;
    }

    const patternKey = `${feature}-${dayOfWeek}`;
    let pattern = patternCache.get(patternKey);
    if (!pattern) {
      pattern = await getHourlyPattern(feature, dayOfWeek);
      patternCache.set(patternKey, pattern);
    }
    const rankEntry = pattern.rankedHours.find((r) => r.hour === hourOfDay);
    const rank = rankEntry?.rank ?? null;
    const totalRanked = pattern.rankedHours.length;

    const confidence = confidenceInfo.recommendation as "low" | "medium" | "high";
    const score = anchor.anchorScore;

    const reasoning = buildReasoning(
      feature,
      mode,
      today.total,
      rank,
      totalRanked,
      confidence,
      crossCheck.broadlyConfirmed,
      crossCheck.topSourceShareOfTotal,
      crossCheck.numberOfSourcesActive
    );

    console.log(`[${feature}/${mode} day=${dayOfWeek} hour=${hourOfDay}] score=${score} confidence=${confidence}`);
    console.log(`  ${reasoning}`);

    if (DRY_RUN) {
      filled++;
      continue;
    }

    const signedPayload = { feature, mode, dayOfWeek, hourOfDay, score, confidence, reasoning };
    const { hash, signature } = signPayload(signedPayload);

    const { error } = await admin.from("verdicts").upsert(
      {
        feature,
        mode,
        day_of_week: dayOfWeek,
        hour_of_day: hourOfDay,
        score,
        confidence,
        reasoning,
        raw_stats: today,
        tool_calls: [
          { tool: "get_today_stats", result: today },
          { tool: "get_historical_average", result: historical },
          { tool: "get_sample_confidence", result: confidenceInfo },
          { tool: "cross_check_sources", result: crossCheck },
          { tool: "get_hourly_pattern", result: pattern },
        ],
        payload_hash: hash,
        signature,
        signed_at: new Date().toISOString(),
      },
      { onConflict: "feature,mode,day_of_week,hour_of_day" }
    );
    if (error) throw new Error(`upsert failed for ${feature}/${mode}/${dayOfWeek}/${hourOfDay}: ${error.message}`);
    filled++;
  }

  console.log(`\n=== Filled ${filled}, skipped (no data at all) ${skippedNoData} ===`);
  if (DRY_RUN) console.log("DRY RUN — no rows were actually written.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
