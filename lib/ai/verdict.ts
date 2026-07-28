// The core agentic loop: Groq (llama-3.3-70b-versatile) reasons about a
// single (feature, mode, day_of_week, hour_of_day) slot by calling tools
// that query real data (lib/ai/tools.ts), then commits to a final verdict
// as structured JSON. This is genuine multi-step tool use, not a single
// prompt narrating precomputed numbers — the model decides which tools to
// call and can call more than one before answering.

import Groq from "groq-sdk";
import { TOOL_DEFINITIONS, callTool, type Feature } from "./tools";

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

function systemPrompt(feature: Feature, mode: Mode, dayOfWeek: number, hourOfDay: number): string {
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
1. Always check the current hour's stats first.
2. Always check how much historical data backs this slot (confidence).
3. Check whether the pattern is confirmed across multiple sources, not just one outlier.
4. Optionally check how this hour ranks against others in the same day.

Be honest and conservative. If there's little data, say confidence is "low" and don't overstate the score. If one source dominates the numbers, mention that this could be less reliable in your reasoning. A high score (8-10) should only be given when the evidence is strong and broad; do not inflate.

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
  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(feature, mode, dayOfWeek, hourOfDay) },
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
      return { ...parsed, toolCallLog };
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
