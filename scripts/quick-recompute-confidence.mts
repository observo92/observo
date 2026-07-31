// Groq-free confidence correction: recomputes every existing verdict's
// "confidence" field using the corrected getSampleConfidence() thresholds
// (3/8 weekly occurrences instead of the old 7/21), re-signs each row.
// Companion to quick-rescore-volume.mts -- same rationale: confidence is
// part of the signed payload, so it must be re-signed, not just overwritten.
//
// Run with: npx tsx -r dotenv/config scripts/quick-recompute-confidence.mts <feature>

import { getSupabaseAdmin } from "../lib/supabase";
import { signPayload } from "../lib/signing";
import { getSampleConfidence } from "../lib/ai/tools";
import type { Feature } from "../lib/ai/tools";

const admin = getSupabaseAdmin();

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  const feature: Feature = (process.argv[2] as Feature) || "volume";
  const { data: verdicts, error } = await admin
    .from("verdicts")
    .select("feature, mode, day_of_week, hour_of_day, score, confidence, reasoning")
    .eq("feature", feature);
  if (error) throw new Error(`verdicts fetch failed: ${error.message}`);

  const confCache = new Map<string, "low" | "medium" | "high">();
  let updated = 0;
  let skipped = 0;

  for (const v of verdicts ?? []) {
    const key = `${v.day_of_week}-${v.hour_of_day}`;
    let newConfidence = confCache.get(key);
    if (!newConfidence) {
      const result = await getSampleConfidence(feature, v.day_of_week, v.hour_of_day);
      newConfidence = result.recommendation as "low" | "medium" | "high";
      confCache.set(key, newConfidence);
    }

    if (newConfidence === v.confidence) {
      skipped++;
      continue;
    }

    const signedPayload = {
      feature: v.feature,
      mode: v.mode,
      dayOfWeek: v.day_of_week,
      hourOfDay: v.hour_of_day,
      score: v.score,
      confidence: newConfidence,
      reasoning: v.reasoning,
    };
    const { hash, signature } = signPayload(signedPayload);

    const { error: updateError } = await admin
      .from("verdicts")
      .update({ confidence: newConfidence, payload_hash: hash, signature, signed_at: new Date().toISOString() })
      .eq("feature", v.feature)
      .eq("mode", v.mode)
      .eq("day_of_week", v.day_of_week)
      .eq("hour_of_day", v.hour_of_day);

    if (updateError) {
      log(`FAILED ${v.mode} day=${v.day_of_week} hour=${v.hour_of_day}: ${updateError.message}`);
      continue;
    }
    updated++;
    log(`updated ${v.mode} day=${v.day_of_week} hour=${v.hour_of_day}: ${v.confidence} -> ${newConfidence}`);
  }

  log(`=== Done: ${updated} updated, ${skipped} unchanged/skipped ===`);
}

main().catch((e) => {
  console.error("QUICK RECOMPUTE CONFIDENCE FAILED:", e);
  process.exit(1);
});
