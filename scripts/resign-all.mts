// One-off maintenance script: re-signs every existing verdict row using
// whatever OBSERVO_SIGNING_PRIVATE_KEY is currently loaded (.env.local),
// WITHOUT calling the AI again — score/confidence/reasoning are untouched,
// only payload_hash/signature/signed_at are recomputed. Needed after the
// signing keypair was rotated at some point but old rows were never
// re-signed, making their signatures fail /api/v1/verify against the
// current public key.
//
// Run with: npx tsx -r dotenv/config scripts/resign-all.mts

import { getSupabaseAdmin } from "../lib/supabase";
import { signPayload } from "../lib/signing";

async function main() {
  const admin = getSupabaseAdmin();

  const rows: Array<{
    feature: string;
    mode: string;
    day_of_week: number;
    hour_of_day: number;
    score: number;
    confidence: string;
    reasoning: string;
  }> = [];

  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await admin
      .from("verdicts")
      .select("feature, mode, day_of_week, hour_of_day, score, confidence, reasoning")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`Re-signing ${rows.length} verdict rows...`);

  let ok = 0;
  for (const row of rows) {
    const signedPayload = {
      feature: row.feature,
      mode: row.mode,
      dayOfWeek: row.day_of_week,
      hourOfDay: row.hour_of_day,
      score: row.score,
      confidence: row.confidence,
      reasoning: row.reasoning,
    };
    const { hash, signature } = signPayload(signedPayload);

    const { error } = await admin
      .from("verdicts")
      .update({ payload_hash: hash, signature, signed_at: new Date().toISOString() })
      .eq("feature", row.feature)
      .eq("mode", row.mode)
      .eq("day_of_week", row.day_of_week)
      .eq("hour_of_day", row.hour_of_day);

    if (error) {
      console.error(`FAILED ${row.feature}/${row.mode} day=${row.day_of_week} hour=${row.hour_of_day}: ${error.message}`);
    } else {
      ok++;
    }
  }

  console.log(`=== Done: ${ok}/${rows.length} re-signed ===`);
}

main().catch((e) => {
  console.error("RESIGN FAILED:", e);
  process.exit(1);
});
