// Backfill raw_snapshots (feature='launch') from Robinhood Chain's own RPC
// node, replacing data collected via the now-abandoned Blockscout pipeline.
//
// Background: Blockscout's legacy getLogs endpoint (the original source
// for launch data) degraded and eventually died over 2026-07-21 to
// 2026-08-01, producing severely undercounted or entirely missing data for
// most of that window (as low as ~0.6% of the real count on some days,
// verified against Pons's own official daily totals). This script re-scans
// the same date range directly via eth_getLogs on the chain's own RPC
// (verified accurate to ~99.5% against Pons's official totals for a full
// day) and upserts corrected counts over the bad data.
//
// Run with --dry-run to only print computed counts without writing to DB.
import "dotenv/config";
import { fetchLogsRpc, BlockTimeEstimator } from "../lib/sources/rpc";
import { LAUNCHPADS, decodeDeploymentLog } from "../lib/sources/launchpads";
import { getSupabaseAdmin } from "../lib/supabase";

const DRY_RUN = process.argv.includes("--dry-run");
const START_DATE = process.argv.find((a) => a.startsWith("--start="))?.split("=")[1] ?? "2026-07-15";

const BLOCKS_PER_SECOND = 1 / 0.101;
const CHUNK_BLOCKS = 100_000; // ~2.8h per chunk, verified safely under the RPC's 10k-log cap

async function getCurrentBlock(): Promise<number> {
  const res = await fetch(process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  });
  return parseInt((await res.json()).result, 16);
}

function utcDateAt(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
}

async function main() {
  const currentBlock = await getCurrentBlock();
  const nowSec = Math.floor(Date.now() / 1000);

  const startSec = utcDateAt(START_DATE);
  const endSec = Math.floor(Date.now() / 1000); // up to now

  const dates: string[] = [];
  for (let d = startSec; d < endSec; d += 86400) {
    dates.push(new Date(d * 1000).toISOString().slice(0, 10));
  }
  console.log(`Backfilling ${dates.length} days: ${dates[0]} -> ${dates[dates.length - 1]} (${DRY_RUN ? "DRY RUN" : "LIVE WRITE"})`);

  // bucket: source|snapshotDate|hourOfDay -> count
  const buckets = new Map<string, { source: string; snapshotDate: string; dayOfWeek: number; hourOfDay: number; count: number }>();

  // Pre-seed every (source, date, hour) combination in the backfill range at
  // 0, so that hours with genuinely zero launches still get an explicit row
  // written -- otherwise stale bad data from the old Blockscout pipeline
  // would silently survive untouched for any hour where the real count
  // happens to be 0 (found via post-backfill verification: pons hour=0 on
  // 2026-07-16 was really 0 launches, but the old wrong value of 704 was
  // never overwritten because a count-0 bucket was never created).
  for (const dateStr of dates) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    for (const config of LAUNCHPADS) {
      for (let h = 0; h < 24; h++) {
        const key = `${config.id}|${dateStr}|${h}`;
        buckets.set(key, { source: config.id, snapshotDate: dateStr, dayOfWeek: d.getUTCDay(), hourOfDay: h, count: 0 });
      }
    }
  }

  for (const dateStr of dates) {
    const dayStart = utcDateAt(dateStr);
    const dayEnd = dayStart + 86400;
    // rough block estimate with margin, refined precisely per-chunk below
    const marginSec = 3600;
    const estFrom = Math.max(0, Math.round(currentBlock - (nowSec - (dayStart - marginSec)) * BLOCKS_PER_SECOND));
    const estTo = Math.min(currentBlock, Math.round(currentBlock - (nowSec - (dayEnd + marginSec)) * BLOCKS_PER_SECOND));

    let dayTotal = 0;
    for (const config of LAUNCHPADS) {
      let sourceDayTotal = 0;
      for (let from = estFrom; from < estTo; from += CHUNK_BLOCKS) {
        const to = Math.min(from + CHUNK_BLOCKS - 1, estTo);
        const estimator = await BlockTimeEstimator.create(from, to);
        let logs;
        try {
          logs = await fetchLogsRpc(config.contractAddress, config.topic0, from, to);
        } catch (e) {
          console.error(`  ERROR ${config.id} [${from}-${to}]: ${(e as Error).message} -- retrying once`);
          await new Promise((r) => setTimeout(r, 2000));
          logs = await fetchLogsRpc(config.contractAddress, config.topic0, from, to);
        }
        for (const log of logs) {
          const blockNumber = parseInt(log.blockNumber, 16);
          const timestampSec = estimator.estimateTimestampSec(blockNumber);
          const decoded = decodeDeploymentLog(config.id, log, timestampSec);
          const d = decoded.deployedAt;
          const ts = Math.floor(d.getTime() / 1000);
          if (ts < dayStart || ts >= dayEnd) continue; // outside target day (margin logs)
          const snapshotDate = d.toISOString().slice(0, 10);
          const hourOfDay = d.getUTCHours();
          const dayOfWeek = d.getUTCDay();
          const key = `${config.id}|${snapshotDate}|${hourOfDay}`;
          const existing = buckets.get(key);
          if (existing) existing.count++;
          else buckets.set(key, { source: config.id, snapshotDate, dayOfWeek, hourOfDay, count: 1 });
          sourceDayTotal++;
        }
      }
      dayTotal += sourceDayTotal;
      console.log(`  ${dateStr} ${config.id}: ${sourceDayTotal}`);
    }
    console.log(`${dateStr} TOTAL (all launchpads): ${dayTotal}`);
  }

  const rows = Array.from(buckets.values()).map((b) => ({
    feature: "launch",
    source: b.source,
    day_of_week: b.dayOfWeek,
    hour_of_day: b.hourOfDay,
    snapshot_date: b.snapshotDate,
    deploy_count: b.count,
  }));

  console.log(`\nTotal buckets computed: ${rows.length}`);

  if (DRY_RUN) {
    console.log("DRY RUN — no writes performed.");
    return;
  }

  const admin = getSupabaseAdmin();
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await admin.from("raw_snapshots").upsert(batch, { onConflict: "feature,source,snapshot_date,hour_of_day" });
    if (error) throw error;
    console.log(`Wrote batch ${i}-${i + batch.length}`);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
