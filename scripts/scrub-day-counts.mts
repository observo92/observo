// One-off cleanup: removes explicit "X days of historical data" style
// phrases from existing verdict reasoning text (replaces with the generic
// "limited historical data"), since surfacing the exact day-count to users
// reads as "we don't have much data, don't trust this" which undermines
// trust rather than building it. Confidence level itself (low/medium/high)
// still communicates the same signal without the raw number. Re-signs each
// changed row since reasoning is part of the signed payload.
//
// Run with: npx tsx -r dotenv/config scripts/scrub-day-counts.mts

import { getSupabaseAdmin } from "../lib/supabase";
import { signPayload } from "../lib/signing";

const admin = getSupabaseAdmin();

function clean(text: string | null): string | null {
  if (!text) return text;
  let t = text;
  t = t.replace(/is limited to (just|only) \d+\s+(distinct\s+)?days?/gi, "is limited");
  t = t.replace(/\bonly\s+\d+\s+distinct\s+days?\s+observed/gi, "limited historical data observed");
  t = t.replace(/\b\d+\s+distinct\s+days?\s+observed/gi, "limited historical data observed");
  t = t.replace(/\bonly\s+\d+\s+(distinct\s+)?days?\s+of\s+(historical\s+)?(data|history)/gi, "limited historical data");
  t = t.replace(/\b\d+\s+(distinct\s+)?days?\s+of\s+(historical\s+)?(data|history)/gi, "limited historical data");
  t = t.replace(/\bbased on only \d+\s+days?\b(?!\s+of)/gi, "based on limited historical data");
  t = t.replace(/\bthe data only goes back \d+\s+days?\b/gi, "the historical data is limited");
  t = t.replace(/\bdata only goes back \d+\s+days?\b/gi, "data is limited");
  t = t.replace(/\ba relatively short history of (just|only) \d+\s+days?\b/gi, "a relatively short history");
  t = t.replace(/\s{2,}/g, " ");
  return t;
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  const { data: verdicts, error } = await admin
    .from("verdicts")
    .select("feature, mode, day_of_week, hour_of_day, score, confidence, reasoning");
  if (error) throw new Error(`fetch failed: ${error.message}`);

  let updated = 0;
  let skipped = 0;

  for (const v of verdicts ?? []) {
    const newReasoning = clean(v.reasoning);
    if (newReasoning === v.reasoning) {
      skipped++;
      continue;
    }

    const signedPayload = {
      feature: v.feature,
      mode: v.mode,
      dayOfWeek: v.day_of_week,
      hourOfDay: v.hour_of_day,
      score: v.score,
      confidence: v.confidence,
      reasoning: newReasoning,
    };
    const { hash, signature } = signPayload(signedPayload);

    const { error: updateError } = await admin
      .from("verdicts")
      .update({ reasoning: newReasoning, payload_hash: hash, signature, signed_at: new Date().toISOString() })
      .eq("feature", v.feature)
      .eq("mode", v.mode)
      .eq("day_of_week", v.day_of_week)
      .eq("hour_of_day", v.hour_of_day);

    if (updateError) {
      log(`FAILED ${v.feature}/${v.mode} day=${v.day_of_week} hour=${v.hour_of_day}: ${updateError.message}`);
      continue;
    }
    updated++;
  }

  log(`=== Done: ${updated} updated, ${skipped} unchanged ===`);
}

main().catch((e) => {
  console.error("SCRUB FAILED:", e);
  process.exit(1);
});
