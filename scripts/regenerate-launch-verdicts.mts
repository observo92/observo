// One-time regeneration of ALL feature="launch" verdicts, after the
// underlying raw_snapshots data for launch was found badly wrong (see
// scripts/backfill-rpc.mts) and re-backfilled from an accurate source
// (2026-08-01). Every existing launch verdict was generated against the
// old bad data (all 336 rows were signed 2026-07-30 to 2026-08-01, right
// in the window that just got corrected by up to 10-100x on some days),
// so they must all be regenerated against the corrected data rather than
// left stale. feature="volume" verdicts are untouched -- that data wasn't
// part of this bug.
//
// Run with: npx tsx -r dotenv/config scripts/regenerate-launch-verdicts.mts

import { generateAndStoreVerdict } from "../lib/ai/store";
import { getSupabaseAdmin } from "../lib/supabase";
import type { Feature } from "../lib/ai/tools";
import type { Mode } from "../lib/ai/verdict";

const MODEL = "llama-3.1-8b-instant";
const FEATURE: Feature = "launch";
const MODES: Mode[] = ["trader", "deployer"];
const CONCURRENCY = 1; // same TPM-limited reasoning as generate-all-verdicts.mts

interface Slot {
  mode: Mode;
  dayOfWeek: number;
  hourOfDay: number;
}

function allSlots(): Slot[] {
  const slots: Slot[] = [];
  for (const mode of MODES) {
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        slots.push({ mode, dayOfWeek: day, hourOfDay: hour });
      }
    }
  }
  return slots;
}

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
  const label = `${FEATURE}/${slot.mode} day=${slot.dayOfWeek} hour=${slot.hourOfDay}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await generateAndStoreVerdict(FEATURE, slot.mode, slot.dayOfWeek, slot.hourOfDay, MODEL);
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

const STALE_CUTOFF = "2026-08-02T00:00:00Z";

async function main() {
  const admin = getSupabaseAdmin();
  const { data: fresh, error } = await admin
    .from("verdicts")
    .select("mode, day_of_week, hour_of_day")
    .eq("feature", FEATURE)
    .gte("signed_at", STALE_CUTOFF);
  if (error) throw new Error(`Failed to fetch fresh verdicts: ${error.message}`);

  const freshSet = new Set(
    (fresh ?? []).map((r) => `${r.mode}|${r.day_of_week}|${r.hour_of_day}`)
  );

  const slots = allSlots().filter(
    (s) => !freshSet.has(`${s.mode}|${s.dayOfWeek}|${s.hourOfDay}`)
  );
  console.log(
    `=== Regenerating ${slots.length} stale launch verdicts (already fresh: ${freshSet.size}, model: ${MODEL}) ===`
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
  console.error("REGENERATION FAILED:", e);
  process.exit(1);
});
