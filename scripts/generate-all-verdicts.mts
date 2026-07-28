// One-time full-grid verdict generation: runs the AI pipeline for every
// (feature, mode, day_of_week, hour_of_day) combination — 2 x 2 x 7 x 24
// = 672 slots — so the heatmap is fully populated from day one, matching
// the same "backfill everything up front" approach used for raw data.
//
// Uses llama-3.1-8b-instant (14,400 req/day free-tier limit) instead of
// the default llama-3.3-70b-versatile (1,000 req/day) because this run
// needs ~1,344 requests in one go, which the 70b model's daily cap can't
// cover. The hourly cron (lib/ai/store.ts default) still uses 70b since
// it only needs ~8 requests/hour.
//
// Run with: npx tsx -r dotenv/config scripts/generate-all-verdicts.mts

import { generateAndStoreVerdict } from "../lib/ai/store";
import { getSupabaseAdmin } from "../lib/supabase";
import type { Feature } from "../lib/ai/tools";
import type { Mode } from "../lib/ai/verdict";

const MODEL = "llama-3.1-8b-instant";
const FEATURES: Feature[] = ["volume", "launch"];
const MODES: Mode[] = ["trader", "deployer"];
// This model's free tier caps at 6,000 tokens/minute (discovered via real
// 429 responses during testing — RPD wasn't the binding constraint, TPM
// was). Each slot uses ~1,000-1,600 tokens across its 2 requests, so
// concurrency must stay low or nearly every call gets rate-limited.
const CONCURRENCY = 1;

interface Slot {
  feature: Feature;
  mode: Mode;
  dayOfWeek: number;
  hourOfDay: number;
}

function allSlots(): Slot[] {
  const slots: Slot[] = [];
  for (const feature of FEATURES) {
    for (const mode of MODES) {
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          slots.push({ feature, mode, dayOfWeek: day, hourOfDay: hour });
        }
      }
    }
  }
  return slots;
}

// Groq's 429 error body includes "Please try again in Xs" OR "Please try
// again in YmXs" (minutes notation once the wait exceeds 60s — e.g.
// "1m43.85s"). The original regex only handled the plain-seconds form,
// silently failing to parse the minutes form and falling back to a short
// fixed backoff that could never actually clear a multi-minute TPD limit —
// found via live testing (a real 429 said "try again in 1m43.85s" but the
// script kept retrying every 4-20s regardless). Handle both forms.
function extractRetryAfterMs(message: string): number | null {
  const withMinutes = message.match(/try again in (\d+)m([\d.]+)s/i);
  if (withMinutes) {
    const minutes = parseInt(withMinutes[1], 10);
    const seconds = parseFloat(withMinutes[2]);
    return Math.ceil((minutes * 60 + seconds) * 1000) + 500;
  }
  const secondsOnly = message.match(/try again in ([\d.]+)s/i);
  if (secondsOnly) {
    return Math.ceil(parseFloat(secondsOnly[1]) * 1000) + 500;
  }
  return null;
}

const MAX_ATTEMPTS = 6;

async function processSlot(slot: Slot, index: number, total: number): Promise<void> {
  const label = `${slot.feature}/${slot.mode} day=${slot.dayOfWeek} hour=${slot.hourOfDay}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await generateAndStoreVerdict(slot.feature, slot.mode, slot.dayOfWeek, slot.hourOfDay, MODEL);
      console.log(`[${index + 1}/${total}] OK  ${label}`);
      return;
    } catch (e) {
      const msg = (e as Error).message;
      const retryAfterMs = extractRetryAfterMs(msg);
      const waitMs = retryAfterMs ?? 4000 * (attempt + 1);
      console.warn(`[${index + 1}/${total}] retry ${attempt + 1}/${MAX_ATTEMPTS} ${label} (waiting ${waitMs}ms): ${msg.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  console.error(`[${index + 1}/${total}] FAILED after ${MAX_ATTEMPTS} attempts: ${label}`);
}

// Token budget is scarce (daily cap), so never regenerate a slot that's
// already stored — this script is meant to be safely re-run across
// multiple days as the daily token budget resets, picking up where it
// left off each time.
async function fetchExistingSlots(): Promise<Set<string>> {
  const admin = getSupabaseAdmin();
  const existing = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await admin
      .from("verdicts")
      .select("feature, mode, day_of_week, hour_of_day")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetchExistingSlots failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      existing.add(`${row.feature}|${row.mode}|${row.day_of_week}|${row.hour_of_day}`);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return existing;
}

async function main() {
  const allSlotsList = allSlots();
  const existing = await fetchExistingSlots();
  const slots = allSlotsList.filter(
    (s) => !existing.has(`${s.feature}|${s.mode}|${s.dayOfWeek}|${s.hourOfDay}`)
  );
  console.log(
    `=== Generating ${slots.length} verdicts (${existing.size} already done, model: ${MODEL}, concurrency: ${CONCURRENCY}) ===`
  );

  let cursor = 0;
  async function worker() {
    while (cursor < slots.length) {
      const i = cursor++;
      await processSlot(slots[i], i, slots.length);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  console.log("=== Done ===");
}

main().catch((e) => {
  console.error("GENERATION FAILED:", e);
  process.exit(1);
});
