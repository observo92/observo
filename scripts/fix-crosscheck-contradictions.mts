// Fixes verdict reasoning text that CONTRADICTS its own cross_check_sources
// tool result — e.g. text says "one source dominates" / "not confirmed
// across multiple sources" when broadlyConfirmed=true (topShare<80%), or
// text says "confirmed across multiple sources" (unnegated) when
// broadlyConfirmed=false (topShare>=80%, real single-outlier dominance).
//
// Same hybrid approach as fix-hallucinated-numbers.mts: the real facts
// (today's total, rank, source count, dominance) are computed
// deterministically from raw_stats/tool_calls, handed to Groq as fixed
// facts with an explicit instruction to phrase them accurately; if the
// model still gets the direction wrong, falls back to a guaranteed-correct
// template sentence for that row only.
//
// Score/confidence untouched — only reasoning text regenerated + re-signed.
//
// Run with: npx tsx -r dotenv/config scripts/fix-crosscheck-contradictions.mts dotenv_config_path=.env.local [--dry-run] [--limit=N]

import Groq from "groq-sdk";
import { getSupabaseAdmin } from "../lib/supabase";
import { signPayload } from "../lib/signing";
import type { Feature } from "../lib/ai/tools";
import type { Mode } from "../lib/ai/verdict";

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = "llama-3.1-8b-instant";

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

interface CrossCheck {
  numberOfSourcesActive: number;
  topSource: string | null;
  topSourceShareOfTotal: number;
  broadlyConfirmed: boolean;
}

interface VerdictRow {
  id: number;
  feature: Feature;
  mode: Mode;
  day_of_week: number;
  hour_of_day: number;
  score: number;
  confidence: "low" | "medium" | "high";
  reasoning: string;
  raw_stats: { total: number } | null;
  tool_calls: Array<{ tool: string; result: Record<string, unknown> }> | null;
}

function getCrossCheck(row: VerdictRow): CrossCheck | null {
  const call = row.tool_calls?.find((t) => t.tool === "cross_check_sources");
  return (call?.result as unknown as CrossCheck) ?? null;
}

function isContradicting(row: VerdictRow): boolean {
  const cc = getCrossCheck(row);
  if (!cc) return false;
  const text = row.reasoning;

  const dominanceMatches = [...text.matchAll(/(.{0,20})(one source dominat|single (source|outlier)|only (one|1) source|driven by a single|only confirmed by one)/gi)];
  const claimsDominance = dominanceMatches.some((m) => !/not\s*$|not a\s*$|isn't\s*$|n't\s*$/i.test(m[1]));

  const negatedConfirm = /not (broadly )?confirmed across|isn't confirmed across|not confirmed by/i.test(text);
  const claimsConfirm = /confirmed across (multiple|several|\d+|two|three|four|five) (independent )?sources|broadly confirmed/i.test(text) && !negatedConfirm;

  if (claimsDominance && cc.broadlyConfirmed === true) return true;
  if (claimsConfirm && cc.broadlyConfirmed === false) return true;
  return false;
}

function getRankInfo(row: VerdictRow): { rank: number | null; totalRanked: number } {
  const patternCall = row.tool_calls?.find((t) => t.tool === "get_hourly_pattern");
  const ranked = (patternCall?.result?.rankedHours as Array<{ hour: number; rank: number }> | undefined) ?? [];
  const entry = ranked.find((r) => r.hour === row.hour_of_day);
  return { rank: entry?.rank ?? null, totalRanked: ranked.length };
}

function buildTemplateFallback(row: VerdictRow, cc: CrossCheck, rank: number | null, totalRanked: number): string {
  const real = row.raw_stats?.total ?? 0;
  const unit = row.feature === "volume" ? "in volume" : "launches";
  const valueStr = row.feature === "volume" ? fmtMoney(real) : `${Math.round(real)}`;
  const rankPhrase = rank != null && totalRanked > 0 ? `, the ${ordinal(rank)} busiest hour of the day` : "";
  const activity = `This hour has seen around ${valueStr} ${unit}${rankPhrase}.`;
  const confirmPhrase = cc.broadlyConfirmed
    ? `This is confirmed across ${cc.numberOfSourcesActive} independent sources.`
    : `However, this isn't confirmed across multiple sources — one source accounts for about ${Math.round(cc.topSourceShareOfTotal * 100)}% of the total.`;
  const confidencePhrase =
    row.confidence === "low"
      ? "This is still building a track record for this hour, so confidence in this reading is low."
      : row.confidence === "medium"
      ? "This slot now has a moderate track record, giving medium confidence in this reading."
      : "This slot has a solid track record, giving high confidence in this reading.";
  return `${activity} ${confirmPhrase} ${confidencePhrase}`;
}

function checkStillContradicts(text: string, cc: CrossCheck): boolean {
  const dominanceMatches = [...text.matchAll(/(.{0,20})(one source dominat|single (source|outlier)|only (one|1) source|driven by a single|only confirmed by one)/gi)];
  const claimsDominance = dominanceMatches.some((m) => !/not\s*$|not a\s*$|isn't\s*$|n't\s*$/i.test(m[1]));
  const negatedConfirm = /not (broadly )?confirmed across|isn't confirmed across|not confirmed by/i.test(text);
  const claimsConfirm = /confirmed across (multiple|several|\d+|two|three|four|five) (independent )?sources|broadly confirmed/i.test(text) && !negatedConfirm;
  if (claimsDominance && cc.broadlyConfirmed === true) return true;
  if (claimsConfirm && cc.broadlyConfirmed === false) return true;
  return false;
}

async function generateWithGroq(row: VerdictRow, cc: CrossCheck, rank: number | null, totalRanked: number): Promise<string | null> {
  const real = row.raw_stats?.total ?? 0;
  const valueStr = row.feature === "volume" ? fmtMoney(real) : `${Math.round(real)}`;
  const unitWord = row.feature === "volume" ? "dollars of trading volume" : "new token launches (a COUNT, not dollars)";
  const rankPhrase = rank != null && totalRanked > 0 ? ` It ranks as the ${ordinal(rank)} busiest hour of the day (out of ${totalRanked}).` : "";
  const confirmFact = cc.broadlyConfirmed
    ? `This IS confirmed across ${cc.numberOfSourcesActive} independent sources — no single source dominates (top source is only ${Math.round(cc.topSourceShareOfTotal * 100)}% of the total). Say this is broadly confirmed / trustworthy.`
    : `This is NOT broadly confirmed — one source (${cc.topSource ?? "a single source"}) accounts for ${Math.round(cc.topSourceShareOfTotal * 100)}% of the total, which is dominant. Say this could be less reliable / driven by one source.`;
  const confidencePhrase =
    row.confidence === "low"
      ? "Confidence in this reading is low (still building a track record for this hour)."
      : row.confidence === "medium"
      ? "Confidence in this reading is medium (a moderate track record backs this slot)."
      : "Confidence in this reading is high (a solid track record backs this slot).";

  const prompt = `Write 1-2 short plain-English sentences describing this hour's activity for a trading/launch timing tool. Use this EXACT number and nothing else: ${valueStr} (${unitWord}).${rankPhrase}

CRITICAL FACT about source confirmation — get this exactly right, don't contradict it: ${confirmFact}

${confidencePhrase}

Rules:
- Quote the number ${valueStr} EXACTLY as given.
- ${row.feature === "launch" ? "NEVER put a dollar sign in front of this number — it is a count of launches, not money." : "This is a dollar amount, keep the $ sign."}
- No jargon, no markdown, just plain sentences.
- Don't state raw day/occurrence counts.
- Respond with ONLY the sentence(s), no preamble, no quotes around it.`;

  try {
    const res = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 150,
    });
    return res.choices[0]?.message?.content?.trim() ?? null;
  } catch (e) {
    console.log(`  Groq call failed: ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("verdicts")
    .select("id, feature, mode, day_of_week, hour_of_day, score, confidence, reasoning, raw_stats, tool_calls");
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as VerdictRow[];
  const contradicting = rows.filter(isContradicting).slice(0, LIMIT);
  console.log(`=== Found ${contradicting.length} cross-check contradictions to fix (of ${rows.length} total) ===`);

  let fixedByAi = 0;
  let fixedByFallback = 0;
  let failed = 0;

  for (const row of contradicting) {
    const cc = getCrossCheck(row)!;
    const { rank, totalRanked } = getRankInfo(row);

    let newReasoning: string | null = await generateWithGroq(row, cc, rank, totalRanked);
    let usedFallback = false;

    if (newReasoning) {
      if (checkStillContradicts(newReasoning, cc)) {
        newReasoning = buildTemplateFallback(row, cc, rank, totalRanked);
        usedFallback = true;
      }
    } else {
      newReasoning = buildTemplateFallback(row, cc, rank, totalRanked);
      usedFallback = true;
    }

    console.log(`[id=${row.id} ${row.feature}/${row.mode} day=${row.day_of_week} hour=${row.hour_of_day}]${usedFallback ? " (fallback)" : " (AI)"}`);
    console.log(`  OLD: ${row.reasoning}`);
    console.log(`  NEW: ${newReasoning}`);

    if (usedFallback) fixedByFallback++;
    else fixedByAi++;

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
      .update({ reasoning: newReasoning, payload_hash: hash, signature, signed_at: new Date().toISOString() })
      .eq("id", row.id);
    if (updateError) {
      failed++;
      console.log(`  UPDATE FAILED: ${updateError.message}`);
    }

    await new Promise((r) => setTimeout(r, 700));
  }

  console.log(`\n=== Fixed via AI: ${fixedByAi}, via fallback template: ${fixedByFallback}, failed: ${failed} ===`);
  if (DRY_RUN) console.log("DRY RUN — no rows were actually updated.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
