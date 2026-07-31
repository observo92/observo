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

  // Generalized pass: catch any sentence fragment that references a
  // specific count (digit or word-form: one/two/three/a single/a few) of
  // "day(s)" tied to history/data/observation, in whatever surrounding
  // phrasing the model used ("limited to X", "backed by X", "based on X",
  // "only have data from X", "the data only goes back X", "evidence is
  // limited to X", etc). Rather than enumerate every exact sentence shape
  // the model has produced (new shapes keep appearing), this collapses
  // the whole "X day(s) of ..." / "day(s) ... observed" noun phrase down
  // to a generic "limited historical data" wherever it appears. Order
  // matters: "limited to (just/only) X day(s)['s] data" must run BEFORE
  // the generic "X day(s) of data" rule, or the generic rule consumes the
  // count first and leaves a redundant "limited to just limited historical
  // data" behind.
  const DAY_COUNT = "(\\d+|one|two|three|a single|a few|only a few)";

  // "evidence/data is limited to (just/only) X day('s) data" -- run first.
  t = t.replace(new RegExp(`(evidence|data)\\s+is\\s+limited\\s+to\\s+(just\\s+|only\\s+)?${DAY_COUNT}\\s+days?('s)?(\\s+(of\\s+)?(historical\\s+)?(data|history))?`, "gi"), "$1 is still limited");
  // "historical data backing this slot is limited to (just/only) X days" -- run first.
  t = t.replace(new RegExp(`limited\\s+to\\s+(just\\s+|only\\s+)?${DAY_COUNT}\\s+days?`, "gi"), "limited");

  // "X day(s) of history/data" (also "day's data" possessive form)
  t = t.replace(new RegExp(`${DAY_COUNT}\\s+(distinct\\s+)?days?('s)?\\s+(of\\s+)?(historical\\s+)?(data|history|observation)\\b`, "gi"), "limited historical data");
  // "X days observed"
  t = t.replace(new RegExp(`${DAY_COUNT}\\s+(distinct\\s+)?days?\\s+observed`, "gi"), "limited historical data observed");
  // "data/evidence only goes back X day(s)"
  t = t.replace(new RegExp(`(data|evidence)\\s+only\\s+goes\\s+back\\s+${DAY_COUNT}\\s+days?`, "gi"), "$1 is still limited");
  // "we only have data from X day(s)"
  t = t.replace(new RegExp(`we\\s+only\\s+have\\s+data\\s+from\\s+${DAY_COUNT}\\s+days?`, "gi"), "we still have limited historical data");
  t = t.replace(new RegExp(`we\\s+only\\s+have\\s+data\\s+from\\s+${DAY_COUNT}\\s+day\\b`, "gi"), "we still have limited historical data");
  // "based on/backed by (just/only) X day(s) of data/history"
  t = t.replace(new RegExp(`(based\\s+on|backed\\s+by)\\s+(just\\s+|only\\s+)?${DAY_COUNT}\\s+days?('s)?\\s+(of\\s+)?(data|history)?`, "gi"), "$1 limited historical data");
  // catch-all: any remaining "<count> day(s)" not already handled above
  t = t.replace(new RegExp(`\\b${DAY_COUNT}\\s+days?\\b`, "gi"), "a short history");

  t = t.replace(/\\bwith limited historical data available, with limited historical data observed/gi, "with limited historical data observed so far");
  t = t.replace(/\\s{2,}/g, " ");
  // Clean up any double articles left behind by substitution (e.g. "a a short history")
  t = t.replace(/\\b(a|an)\\s+(a|an)\\s+/gi, "$1 ");
  return t;
}function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const { data: verdicts, error } = await admin
    .from("verdicts")
    .select("feature, mode, day_of_week, hour_of_day, score, confidence, reasoning");
  if (error) throw new Error(`fetch failed: ${error.message}`);

  let updated = 0;
  let skipped = 0;
  let stillBad = 0;

  for (const v of verdicts ?? []) {
    const newReasoning = clean(v.reasoning);
    if (newReasoning === v.reasoning) {
      skipped++;
      continue;
    }
    if (/\bdays?\s+of\s+(history|data)|days?\s+observed|distinct\s+days?|single day|one day\b/i.test(newReasoning || "")) {
      stillBad++;
      log(`STILL BAD: ${newReasoning}`);
    }
    if (dryRun) {
      log(`WOULD UPDATE ${v.feature}/${v.mode} day=${v.day_of_week} hour=${v.hour_of_day}:`);
      log(`  OLD: ${v.reasoning}`);
      log(`  NEW: ${newReasoning}`);
      updated++;
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

  log(`=== Done: ${updated} ${dryRun ? "would-be-updated" : "updated"}, ${skipped} unchanged, ${stillBad} still-bad ===`);
}

main().catch((e) => {
  console.error("SCRUB FAILED:", e);
  process.exit(1);
});
