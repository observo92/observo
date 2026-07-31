// The core agentic loop: Groq (llama-3.3-70b-versatile) reasons about a
// single (feature, mode, day_of_week, hour_of_day) slot by calling tools
// that query real data (lib/ai/tools.ts), then commits to a final verdict
// as structured JSON. This is genuine multi-step tool use, not a single
// prompt narrating precomputed numbers — the model decides which tools to
// call and can call more than one before answering.

import Groq from "groq-sdk";
import { TOOL_DEFINITIONS, callTool, getAnchorScore, type Feature } from "./tools";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Groq's real binding constraint turned out to be TPD (tokens per day),
// not RPD — measured live: llama-3.3-70b-versatile only gets 100,000
// tokens/day, while llama-3.1-8b-instant gets 500,000 tokens/day. The
// hourly cron needs ~192,000 tokens/day (4 verdicts/hour x 24h x ~2,000
// tokens/verdict), which only fits under the 8b model's daily budget — the
// 70b model would hit its daily cap every single day. So 8b is the default
// for ongoing/cron use; the one-time full-grid generation script also uses
// 8b for the same reason, just spread out over several days as its daily
// budget resets (that one-time backfill needs ~1.3M tokens total, which
// exceeds even one day's 8b budget).
const DEFAULT_MODEL = "llama-3.1-8b-instant";
const MAX_TOOL_ROUNDS = 6; // hard cap so a stuck loop can't run forever

export type Mode = "trader" | "deployer";

export interface VerdictResult {
  score: number; // 0-10
  confidence: "low" | "medium" | "high";
  reasoning: string;
  toolCallLog: Array<{ tool: string; result: unknown }>;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function systemPrompt(feature: Feature, mode: Mode, dayOfWeek: number, hourOfDay: number, anchorScore: number): string {
  const dayName = DAY_NAMES[dayOfWeek];
  const subject =
    feature === "volume"
      ? "trading volume across DEX pools on Robinhood Chain"
      : "new token launches across launchpads (flap.sh, Pons, bow.fun) on Robinhood Chain";

  const audience =
    mode === "trader"
      ? "a retail trader deciding whether this is generally a good time to be active in the market"
      : "someone planning to launch/deploy a new token, deciding whether this hour tends to get attention or gets ignored";

  return `You are Observo's analysis engine. You're evaluating ${subject}, specifically for ${dayName} at ${String(hourOfDay).padStart(2, "0")}:00 UTC.

Your audience is ${audience}. They are NOT technical — you must reason carefully using the tools available, but your final "reasoning" text must be plain, simple English with no jargon (no words like "SCAN", "verify", "cross-check", "sample size" — just explain what you found in normal language, 1-3 sentences).

Use the tools to gather evidence before answering:
1. Always check get_today_stats first — this is what actually happened, for real, the most recent time this exact hour-of-week slot occurred.
2. Always check how much historical data backs this slot (get_sample_confidence).
3. Check whether today's activity is confirmed across multiple sources, not just one outlier (cross_check_sources).
4. Optionally check get_historical_average and get_hourly_pattern for context — e.g. whether today is higher or lower than usual, or how this hour ranks against others.

IMPORTANT — the score is NOT something you invent from scratch:
- You've been given a STATISTICAL ANCHOR SCORE of ${anchorScore}/10, precomputed from where today's actual number for this slot ranks (percentile) among all 168 hour-of-week slots for this feature. This anchor is math, not a guess -- treat it as your starting point.
- Your final "score" must stay within 2 points of this anchor (${anchorScore}) in either direction. You may adjust it up or down within that range based on genuine qualitative signals -- e.g. lower it slightly if cross_check_sources shows the number is really just one outlier source with no real breadth, or if get_sample_confidence shows this is backed by very little history. Do not just repeat the anchor with no thought, but do not invent a wildly different number either.
- "confidence" (low/medium/high) reflects only how much historical data backs this slot (from get_sample_confidence). Little history = low confidence, but that alone should NOT drag the score down — it just means the UI will show this is a newer read. IMPORTANT: never mention the specific number of days/occurrences observed in your reasoning text (e.g. do not write "only 2 days of data" or "3 distinct days observed") — it reads as undermining trust in the product. If you want to note limited history, use vague phrasing like "still building a track record for this hour" instead of a raw count.
- Mention the actual dollar/count numbers from get_today_stats in your reasoning (e.g. "around $2.3M in volume this hour") so the reasoning is concrete and about what really happened, not vague or averaged. If one source dominates today's total, you can still mention that, but don't let it override a genuinely large, real number — only discount it if today's total itself looks like noise (e.g. under a few thousand dollars from a single wallet).
- CRITICAL: get_today_stats' "total" is the REAL number for this exact slot -- always quote THIS number as "today's"/"this hour's" volume or count. get_historical_average's "average" is a DIFFERENT, separate number (the average across all past occurrences of this slot) -- if you mention it at all, always label it explicitly as "average"/"usually"/"typically", never as what happened "today" or "this hour". Do not substitute one for the other.

When you're done gathering evidence, respond with ONLY a JSON object (no markdown, no extra text) in this exact shape:
{"score": <integer 0-10>, "confidence": "low"|"medium"|"high", "reasoning": "<plain English, 1-3 sentences>"}`;
}

export async function generateVerdict(
  feature: Feature,
  mode: Mode,
  dayOfWeek: number,
  hourOfDay: number,
  model: string = DEFAULT_MODEL
): Promise<VerdictResult> {
  const { anchorScore } = await getAnchorScore(feature, dayOfWeek, hourOfDay);

  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(feature, mode, dayOfWeek, hourOfDay, anchorScore) },
    { role: "user", content: "Begin your analysis." },
  ];

  const toolCallLog: Array<{ tool: string; result: unknown }> = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await groq.chat.completions.create({
      model,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
      temperature: 0.2,
    });

    const choice = response.choices[0];
    const message = choice.message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: message.tool_calls,
      });

      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name;
        let result: unknown;
        try {
          result = await callTool(toolName, feature, dayOfWeek, hourOfDay);
        } catch (e) {
          result = { error: (e as Error).message };
        }
        toolCallLog.push({ tool: toolName, result });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    // No more tool calls — model should now be answering with the final JSON.
    const raw = (message.content ?? "").trim();
    const parsed = parseVerdictJson(raw);
    if (parsed) {
      // Hard clamp: whatever the model decided, it can never end up more
      // than 2 points away from the precomputed statistical anchor. This
      // guarantees the score stays grounded in real data even if the model
      // ignores the prompt's instruction to self-limit its adjustment.
      const clampedScore = Math.min(anchorScore + 2, Math.max(anchorScore - 2, parsed.score));
      return { ...parsed, score: Math.min(10, Math.max(0, clampedScore)), toolCallLog };
    }

    // Model answered but not in the expected JSON shape — ask it once,
    // explicitly, to reformat rather than silently failing.
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content:
        'Respond with ONLY the JSON object, no other text: {"score": <0-10>, "confidence": "low"|"medium"|"high", "reasoning": "..."}',
    });
  }

  throw new Error(
    `generateVerdict: exceeded ${MAX_TOOL_ROUNDS} rounds without a valid final verdict (feature=${feature} mode=${mode} day=${dayOfWeek} hour=${hourOfDay})`
  );
}

function parseVerdictJson(
  raw: string
): { score: number; confidence: "low" | "medium" | "high"; reasoning: string } | null {
  // Model sometimes wraps JSON in markdown fences despite instructions — strip them.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const obj = JSON.parse(cleaned);
    if (
      typeof obj.score === "number" &&
      obj.score >= 0 &&
      obj.score <= 10 &&
      ["low", "medium", "high"].includes(obj.confidence) &&
      typeof obj.reasoning === "string" &&
      obj.reasoning.length > 0
    ) {
      return {
        score: Math.round(obj.score),
        confidence: obj.confidence,
        reasoning: obj.reasoning,
      };
    }
  } catch {
    // fall through
  }
  return null;
}
