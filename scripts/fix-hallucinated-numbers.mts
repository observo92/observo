// Fixes verdict reasoning text that quotes a dollar/count number not
// actually backed by real data (either mislabeled unit — e.g. launch
// counts phrased as dollars — or outright invented by the model, e.g. the
// same "$2.3M" appearing across dozens of unrelated rows with different
// real totals).
//
// HYBRID approach (not pure template): the real number is computed
// deterministically from raw_stats (same source of truth as the rest of
// the app), then handed to Groq as a FIXED FACT with an explicit
// instruction to use it exactly, not invent or recompute anything. The
// model's job is only to phrase a natural sentence around a number it's
// given, not to produce the number itself. After the model responds, the
// number it actually wrote is re-extracted and checked against the real
// value — if the model still didn't quote it correctly, that row falls
// back to a deterministic template sentence instead of being left wrong.
//
// Score/confidence are NOT touched — those are separately computed and
// already valid; only the reasoning text is regenerated. Each changed row
// is re-signed (reasoning is part of the signed payload).
//
// Run with: npx tsx -r dotenv/config scripts/fix-hallucinated-numbers.mts dotenv_config_path=.env.local [--dry-run] [--limit=N]

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

interface VerdictRow {
  id: number;
  feature: Feature;
  mode: Mode;
  day_of_week: number;
  hour_of_day: number;
  score: number;
  confidence: "low" | "medium" | "high";
  reasoning: string;
  raw_stats: { total: number; bySource?: Record<string, number> } | null;
  tool_calls: Array<{ tool: string; result: Record<string, unknown> }> | null;
}

function extractQuotedNumber(text: string): number | null {
  const m = text.match(/\$?([\d,]+(?:\.\d+)?)\s*([MK])?/i);
  if (!m) return null;
  let val = parseFloat(m[1].replace(/,/g, ""));
  if (m[2]?.toUpperCase() === "M") val *= 1e6;
  else if (m[2]?.toUpperCase() === "K") val *= 1e3;
  return val;
}

function isMismatched(row: VerdictRow): boolean {
  if (!row.raw_stats || row.raw_stats.total == null) return false;
  const real = row.raw_stats.total;
  // Look for ANY dollar-sign mention (that alone is wrong for launch) or
  // any number-with-unit mention, then compare to the real total.
  const dollarMatch = row.reasoning.match(/\$[\d,.]+\s*[MK]?/i);
  if (row.feature === "launch" && dollarMatch) return true; // dollar sign is always wrong for launch
  const numMatch = row.reasoning.match(/(?:around|about)?\s*([\d,]+(?:\.\d+)?)\s*(M|K)?\s*(launches|new tokens|in volume)/i);
  if (!numMatch) return false;
  let val = parseFloat(numMatch[1].replace(/,/g, ""));
  if (numMatch[2]?.toUpperCase() === "M") val *= 1e6;
  else if (numMatch[2]?.toUpperCase() === "K") val *= 1e3;
  if (real === 0) return false;
  const dist = Math.abs(val - real) / Math.max(val, real, 1);
  return dist > 0.1;
}

function buildTemplateFallback(row: VerdictRow, rank: number | null, totalRanked: number): string {
  const real = row.raw_stats!.total;
  const unit = row.feature === "volume" ? "in volume" : "launches";
  const valueStr = row.feature === "volume" ? fmtMoney(real) : `${Math.round(real)}`;
  const rankPhrase = rank != null && totalRanked > 0 ? `, the ${ordinal(rank)} busiest hour of the day` : "";
  const activity = `This hour has seen around ${valueStr} ${unit}${rankPhrase}.`;
  const confidencePhrase =
    row.confidence === "low"
      ? "This is still building a track record for this hour, so confidence in this reading is low."
      : row.confidence === "medium"
      ? "This slot now has a moderate track record, giving medium confidence in this reading."
      : "This slot has a solid track record, giving high confidence in this reading.";
  return `${activity} ${confidencePhrase}`;
}

async function getRankInfo(row: VerdictRow): Promise<{ rank: number | null; totalRanked: number }> {
  const patternCall = row.tool_calls?.find((t) => t.tool === "get_hourly_pattern");
  const ranked = (patternCall?.result?.rankedHours as Array<{ hour: number; rank: number }> | undefined) ?? [];
  const entry = ranked.find((r) => r.hour === row.hour_of_day);
  return { rank: entry?.rank ?? null, totalRanked: ranked.length };
}

async function generateWithGroq(row: VerdictRow, rank: number | null, totalRanked: number): Promise<string | null> {
  const real = row.raw_stats!.total;
  const valueStr = row.feature === "volume" ? fmtMoney(real) : `${Math.round(real)}`;
  const unitWord = row.feature === "volume" ? "dollars of trading volume" : "new token launches (a COUNT, not dollars)";
  const rankPhrase = rank != null && totalRanked > 0 ? ` It ranks as the ${ordinal(rank)} busiest hour of the day (out of ${totalRanked}).` : "";
  const confidencePhrase =
    row.confidence === "low"
      ? "Confidence in this reading is low (still building a track record for this hour)."
      : row.confidence === "medium"
      ? "Confidence in this reading is medium (a moderate track record backs this slot)."
      : "Confidence in this reading is high (a solid track record backs this slot).";

  const prompt = `Write 1-2 short plain-English sentences describing this hour's activity for a trading/launch timing tool. You MUST use this EXACT number and nothing else — do not invent, round differently, or substitute any other number: ${valueStr} (${unitWord}).${rankPhrase} ${confidencePhrase}

Rules:
- Quote the number ${valueStr} EXACTLY as given, in your first sentence.
- ${row.feature === "launch" ? "NEVER put a dollar sign in front of this number — it is a count of launches, not money." : "This is a dollar amount, keep the $ sign."}
- No jargon, no markdown, just plain sentences.
- Mention the confidence framing naturally (don't state raw day/occurrence counts).
- Respond with ONLY the sentence(s), no preamble, no quotes around it.`;

  try {
    const res = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 150,
    });
    const text = res.choices[0]?.message?.content?.trim() ?? null;
    return text;
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
  const mismatched = rows.filter(isMismatched).slice(0, LIMIT);
  console.log(`=== Found ${mismatched.length} mismatched rows to fix (of ${rows.length} total) ===`);

  let fixedByAi = 0;
  let fixedByFallback = 0;
  let failed = 0;

  for (const row of mismatched) {
    const { rank, totalRanked } = await getRankInfo(row);
    const real = row.raw_stats!.total;

    let newReasoning: string | null = await generateWithGroq(row, rank, totalRanked);
    let usedFallback = false;

    if (newReasoning) {
      const quoted = extractQuotedNumber(newReasoning);
      const dist = quoted != null ? Math.abs(quoted - real) / Math.max(quoted, real, 1) : 1;
      const hasDollarButShouldnt = row.feature === "launch" && /\$/.test(newReasoning);
      if (quoted == null || dist > 0.02 || hasDollarButShouldnt) {
        // AI still got it wrong — fall back to guaranteed-correct template.
        newReasoning = buildTemplateFallback(row, rank, totalRanked);
        usedFallback = true;
      }
    } else {
      newReasoning = buildTemplateFallback(row, rank, totalRanked);
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
      .update({
        reasoning: newReasoning,
        payload_hash: hash,
        signature,
        signed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) {
      failed++;
      console.log(`  UPDATE FAILED: ${updateError.message}`);
    }

    // Small gap to stay comfortably under Groq's TPM limit.
    await new Promise((r) => setTimeout(r, 700));
  }

  console.log(`\n=== Fixed via AI: ${fixedByAi}, via fallback template: ${fixedByFallback}, failed updates: ${failed} ===`);
  if (DRY_RUN) console.log("DRY RUN — no rows were actually updated.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
