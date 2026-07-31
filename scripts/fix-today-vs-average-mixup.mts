// One-time patch: fixes verdict rows generated before the verdict.ts prompt
// was corrected to distinguish get_today_stats' "total" (today's real
// number) from get_historical_average's "average" (a separate, different
// number). Some older AI-generated reasoning text quoted the historical
// average while calling it "today's"/"this hour's" volume or count.
//
// Detects this by comparing the number literally mentioned in the
// reasoning text against both today's actual value and the historical
// average; if the mentioned number matches the average (not today's
// value), it's swapped in-place. Re-signs each changed row (reasoning is
// part of the signed payload).
//
// Run with: npx tsx -r dotenv/config scripts/fix-today-vs-average-mixup.mts dotenv_config_path=.env.local [--dry-run]

import { getSupabaseAdmin } from "../lib/supabase";
import { signPayload } from "../lib/signing";

const DRY_RUN = process.argv.includes("--dry-run");

function formatLikeOriginal(value: number, style: "M" | "K" | "plain", decimals: number): string {
  if (style === "M") return `$${(value / 1e6).toFixed(decimals)}M`;
  if (style === "K") return `$${(value / 1e3).toFixed(decimals)}K`;
  return `$${value.toFixed(decimals)}`;
}

async function main() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("verdicts")
    .select("id, feature, mode, day_of_week, hour_of_day, score, confidence, reasoning, tool_calls");
  if (error) throw new Error(error.message);

  let checked = 0;
  let fixed = 0;
  const skippedNoMatch: number[] = [];

  for (const row of data ?? []) {
    if (!row.tool_calls) continue;
    const todayCall = (row.tool_calls as Array<{ tool: string; result: Record<string, unknown> }>).find(
      (t) => t.tool === "get_today_stats"
    );
    const avgCall = (row.tool_calls as Array<{ tool: string; result: Record<string, unknown> }>).find(
      (t) => t.tool === "get_historical_average"
    );
    if (!todayCall || !avgCall) continue;

    const todayVal = (todayCall.result.total ?? todayCall.result.count) as number | undefined;
    const avgVal = (avgCall.result.average ?? avgCall.result.count) as number | undefined;
    if (todayVal == null || avgVal == null) continue;
    if (todayVal === 0 || avgVal === 0) continue;
    if (Math.abs(todayVal - avgVal) / Math.max(todayVal, avgVal) < 0.05) continue; // too close to matter

    checked++;

    // Find "$X.YM" / "$X.YK" / "$X" style number mentions near "today"/"this hour" phrasing.
    const mentionRegex = /(today|this hour)('s)?[^.]*?\$([\d,.]+)\s*([MK])?/i;
    const m = row.reasoning.match(mentionRegex);
    if (!m) {
      skippedNoMatch.push(row.id);
      continue;
    }

    const rawNumStr = m[3];
    const unit = m[4] as "M" | "K" | undefined;
    let mentioned = parseFloat(rawNumStr.replace(/,/g, ""));
    if (unit === "M") mentioned *= 1e6;
    else if (unit === "K") mentioned *= 1e3;

    const distToToday = Math.abs(mentioned - todayVal) / todayVal;
    const distToAvg = Math.abs(mentioned - avgVal) / avgVal;

    // Only fix the clear case: text number matches the AVERAGE, not today's value.
    if (!(distToAvg < 0.02 && distToToday > 0.05)) continue;

    // Reconstruct the replacement string in the same style (M/K/plain, same decimal count).
    const decimals = (rawNumStr.split(".")[1] ?? "").length;
    const style: "M" | "K" | "plain" = unit === "M" ? "M" : unit === "K" ? "K" : "plain";
    const replacement = formatLikeOriginal(todayVal, style, decimals || 1);
    const originalMatchedText = `$${rawNumStr}${unit ?? ""}`;
    const newReasoning = row.reasoning.replace(originalMatchedText, replacement);

    if (newReasoning === row.reasoning) {
      skippedNoMatch.push(row.id);
      continue;
    }

    fixed++;
    console.log(`[${row.feature}/${row.mode} day=${row.day_of_week} hour=${row.hour_of_day}] id=${row.id}`);
    console.log(`  OLD: ${row.reasoning}`);
    console.log(`  NEW: ${newReasoning}`);

    if (DRY_RUN) continue;

    const signedPayload = {
      feature: row.feature,
      mode: row.mode,
      dayOfWeek: row.day_of_week,
      hourOfDay: row.hour_of_day,
      score: row.score,
      confidence: row.confidence,
      reasoning: newReasoning,
    };
    const { hash, signature } = signPayload(signedPayload);

    const { error: updateError } = await admin
      .from("verdicts")
      .update({
        reasoning: newReasoning,
        payload_hash: hash,
        signature,
        signed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) throw new Error(`update failed for id=${row.id}: ${updateError.message}`);
  }

  console.log(`\n=== Checked ${checked} candidate rows (today != avg by >5%), fixed ${fixed}, no-text-match ${skippedNoMatch.length} ===`);
  if (skippedNoMatch.length > 0) console.log("No-match IDs (reasoning didn't reference a today/this-hour number pattern):", skippedNoMatch);
  if (DRY_RUN) console.log("DRY RUN — no rows were actually updated.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
