// Upgrades verdict rows that were filled by the pure-template script
// (fill-missing-verdicts-template.mts) into the hybrid style: same real
// number (deterministic, from raw_stats), but the sentence is phrased by
// Groq instead of a fixed template string, so the wording matches the
// more natural style used everywhere else (see fix-hallucinated-numbers.mts).
//
// Selection: rows with signed_at >= a given ISO cutoff (the moment the
// template-fill script ran). Score/confidence untouched — only reasoning
// text is regenerated and the row re-signed.
//
// Run with: npx tsx -r dotenv/config scripts/upgrade-template-to-hybrid.mts dotenv_config_path=.env.local --since=2026-08-01T00:30:00Z [--dry-run] [--limit=N]

import Groq from "groq-sdk";
import { getSupabaseAdmin } from "../lib/supabase";
import { signPayload } from "../lib/signing";
import type { Feature } from "../lib/ai/tools";
import type { Mode } from "../lib/ai/verdict";

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
const sinceArg = process.argv.find((a) => a.startsWith("--since="));
if (!sinceArg) {
  console.error("Missing --since=<ISO timestamp>");
  process.exit(1);
}
const SINCE = sinceArg.split("=")[1];

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

function getRankInfo(row: VerdictRow): { rank: number | null; totalRanked: number } {
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
    .select("id, feature, mode, day_of_week, hour_of_day, score, confidence, reasoning, raw_stats, tool_calls, signed_at")
    .gte("signed_at", SINCE)
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data ?? []).filter((r) => r.raw_stats?.total != null).slice(0, LIMIT) as VerdictRow[];
  console.log(`=== Upgrading ${rows.length} template rows to hybrid AI phrasing (since ${SINCE}) ===`);

  let fixedByAi = 0;
  let fixedByFallback = 0;
  let failed = 0;

  for (const row of rows) {
    const { rank, totalRanked } = getRankInfo(row);
    const real = row.raw_stats!.total;

    let newReasoning: string | null = await generateWithGroq(row, rank, totalRanked);
    let usedFallback = false;

    if (newReasoning) {
      const quoted = extractQuotedNumber(newReasoning);
      const dist = quoted != null ? Math.abs(quoted - real) / Math.max(quoted, real, 1) : 1;
      const hasDollarButShouldnt = row.feature === "launch" && /\$/.test(newReasoning);
      if (quoted == null || dist > 0.02 || hasDollarButShouldnt) {
        newReasoning = buildTemplateFallback(row, rank, totalRanked);
        usedFallback = true;
      }
    } else {
      newReasoning = buildTemplateFallback(row, rank, totalRanked);
      usedFallback = true;
    }

    console.log(`[id=${row.id} ${row.feature}/${row.mode} day=${row.day_of_week} hour=${row.hour_of_day}]${usedFallback ? " (fallback)" : " (AI)"}`);
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
