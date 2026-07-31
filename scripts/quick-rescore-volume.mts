// Fast, Groq-free score correction: recomputes every existing volume
// verdict's "score" field using the same deterministic percentile-based
// anchor logic as getAnchorScore() in lib/ai/tools.ts, re-signs each row
// (score is part of the signed payload, so it can't just be overwritten
// without re-signing or verification would break), and leaves the
// existing AI-written "reasoning"/"confidence" untouched for now. This
// exists purely to fix the heatmap's visual clustering (most cells showing
// the same bright color) immediately, without waiting on Groq's daily
// token budget to regenerate all 336 verdicts via the AI. Reasoning text
// will be refreshed properly later via scripts/regenerate-volume-verdicts.mts
// once Groq quota allows -- this script is a stopgap, not a replacement.
//
// Run with: npx tsx -r dotenv/config scripts/quick-rescore-volume.mts

import { getSupabaseAdmin } from "../lib/supabase";
import { signPayload } from "../lib/signing";
import type { Feature } from "../lib/ai/tools";

const admin = getSupabaseAdmin();

interface RawRow {
  day_of_week: number;
  hour_of_day: number;
  source: string;
  snapshot_date: string;
  volume_usd: number | null;
  deploy_count: number | null;
}

function metricValue(row: RawRow, feature: Feature): number {
  return feature === "volume" ? row.volume_usd ?? 0 : row.deploy_count ?? 0;
}

async function computeAnchorScores(feature: Feature): Promise<Map<string, number>> {
  const { data, error } = await admin
    .from("raw_snapshots")
    .select("day_of_week, hour_of_day, source, snapshot_date, volume_usd, deploy_count")
    .eq("feature", feature);
  if (error) throw new Error(`raw_snapshots fetch failed: ${error.message}`);
  const rows = (data ?? []) as RawRow[];

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

  const values = Array.from(slotLatest.values()).map((e) => e.value).sort((a, b) => a - b);
  const scores = new Map<string, number>();
  for (const [key, entry] of slotLatest.entries()) {
    let countBelowOrEqual = 0;
    for (const v of values) if (v <= entry.value) countBelowOrEqual++;
    const percentile = (countBelowOrEqual / values.length) * 100;
    const anchorScore = Math.min(10, Math.max(0, Math.round(percentile / 10)));
    scores.set(key, anchorScore);
  }
  return scores;
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  const feature: Feature = (process.argv[2] as Feature) || "volume";
  log("Computing anchor scores from raw_snapshots...");
  const anchorScores = await computeAnchorScores(feature);
  log(`Computed anchor scores for ${anchorScores.size} slots`);

  const { data: verdicts, error } = await admin
    .from("verdicts")
    .select("feature, mode, day_of_week, hour_of_day, score, confidence, reasoning")
    .eq("feature", feature);
  if (error) throw new Error(`verdicts fetch failed: ${error.message}`);

  let updated = 0;
  let skipped = 0;
  for (const v of verdicts ?? []) {
    const key = `${v.day_of_week}-${v.hour_of_day}`;
    const anchorScore = anchorScores.get(key);
    if (anchorScore === undefined) {
      skipped++;
      continue;
    }
    if (anchorScore === v.score) {
      skipped++;
      continue;
    }

    const signedPayload = {
      feature: v.feature,
      mode: v.mode,
      dayOfWeek: v.day_of_week,
      hourOfDay: v.hour_of_day,
      score: anchorScore,
      confidence: v.confidence,
      reasoning: v.reasoning,
    };
    const { hash, signature } = signPayload(signedPayload);

    const { error: updateError } = await admin
      .from("verdicts")
      .update({
        score: anchorScore,
        payload_hash: hash,
        signature,
        signed_at: new Date().toISOString(),
      })
      .eq("feature", v.feature)
      .eq("mode", v.mode)
      .eq("day_of_week", v.day_of_week)
      .eq("hour_of_day", v.hour_of_day);

    if (updateError) {
      log(`FAILED ${v.mode} day=${v.day_of_week} hour=${v.hour_of_day}: ${updateError.message}`);
      continue;
    }
    updated++;
    log(`updated ${v.mode} day=${v.day_of_week} hour=${v.hour_of_day}: ${v.score} -> ${anchorScore}`);
  }

  log(`=== Done: ${updated} updated, ${skipped} unchanged/skipped ===`);
}

main().catch((e) => {
  console.error("QUICK RESCORE FAILED:", e);
  process.exit(1);
});
