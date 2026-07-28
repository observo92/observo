// Generates a verdict, signs it, and upserts it into the verdicts table.
// Single entry point used by both the one-time full-grid generation script
// and the hourly cron (which only refreshes the current hour-of-week slot).

import { getSupabaseAdmin } from "../supabase";
import { signPayload } from "../signing";
import { generateVerdict, type Mode } from "./verdict";
import type { Feature } from "./tools";

export async function generateAndStoreVerdict(
  feature: Feature,
  mode: Mode,
  dayOfWeek: number,
  hourOfDay: number,
  model?: string
): Promise<void> {
  const result = await generateVerdict(feature, mode, dayOfWeek, hourOfDay, model);

  // Signed payload is the deterministic, meaningful subset — not the raw
  // tool-call log (which can include incidental fields) — so verification
  // stays stable even if we add more diagnostic tool output later.
  const signedPayload = {
    feature,
    mode,
    dayOfWeek,
    hourOfDay,
    score: result.score,
    confidence: result.confidence,
    reasoning: result.reasoning,
  };
  const { hash, signature } = signPayload(signedPayload);

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("verdicts").upsert(
    {
      feature,
      mode,
      day_of_week: dayOfWeek,
      hour_of_day: hourOfDay,
      score: result.score,
      confidence: result.confidence,
      reasoning: result.reasoning,
      raw_stats: result.toolCallLog.find((t) => t.tool === "get_current_hour_stats")?.result ?? null,
      tool_calls: result.toolCallLog,
      payload_hash: hash,
      signature,
      signed_at: new Date().toISOString(),
    },
    { onConflict: "feature,mode,day_of_week,hour_of_day" }
  );

  if (error) {
    throw new Error(`generateAndStoreVerdict upsert failed (${feature}/${mode}/${dayOfWeek}/${hourOfDay}): ${error.message}`);
  }
}
