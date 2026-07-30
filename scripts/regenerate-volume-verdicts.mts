// Regenerates ALL volume verdicts (168 day/hour slots x 2 modes = 336) using
// the fixed tool logic (today's real number for score, historical average
// only as context) and the volume data backfilled from GeckoTerminal
// earlier this session. Unlike scripts/generate-all-verdicts.mts, this does
// NOT skip slots that already have a verdict — every volume verdict is
// stale relative to the tool/prompt fix and needs to be regenerated, not
// just the previously-missing ones. Launch verdicts are intentionally left
// alone here since the launch raw_snapshots backfill hasn't completed yet
// (blocked on a Blockscout rate limit) — regenerating launch verdicts now
// would just bake in the same undercounting bug this session has been
// fixing elsewhere.
//
// Run with: npx tsx -r dotenv/config scripts/regenerate-volume-verdicts.mts

import { generateAndStoreVerdict } from "../lib/ai/store";
import type { Mode } from "../lib/ai/verdict";

const MODEL = "llama-3.1-8b-instant";
const MODES: Mode[] = ["trader", "deployer"];
const CONCURRENCY = 1;

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

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function processSlot(slot: Slot, index: number, total: number): Promise<void> {
  const label = `volume/${slot.mode} day=${slot.dayOfWeek} hour=${slot.hourOfDay}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await generateAndStoreVerdict("volume", slot.mode, slot.dayOfWeek, slot.hourOfDay, MODEL);
      log(`[${index + 1}/${total}] OK  ${label}`);
      return;
    } catch (e) {
      const msg = (e as Error).message;
      const retryAfterMs = extractRetryAfterMs(msg);
      const waitMs = retryAfterMs ?? 4000 * (attempt + 1);
      log(`[${index + 1}/${total}] retry ${attempt + 1}/${MAX_ATTEMPTS} ${label} (waiting ${waitMs}ms): ${msg.slice(0, 150)}`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  log(`[${index + 1}/${total}] FAILED after ${MAX_ATTEMPTS} attempts: ${label}`);
}

async function main() {
  const slots = allSlots();
  log(`=== Regenerating ${slots.length} volume verdicts (model: ${MODEL}) ===`);

  let cursor = 0;
  async function worker() {
    while (cursor < slots.length) {
      const i = cursor++;
      await processSlot(slots[i], i, slots.length);
    }
  }
  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  log("=== Done ===");
}

main().catch((e) => {
  console.error("REGENERATE FAILED:", e);
  process.exit(1);
});
