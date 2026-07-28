// env loaded via -r dotenv/config, see package.json script
// One-time (or periodically re-run) historical backfill: pulls the past
// N days of volume + launch data directly from GeckoTerminal/Blockscout
// and populates raw_snapshots, so the heatmap has real data from day one
// instead of starting empty and filling in hour by hour.
//
// Run with: npx tsx scripts/backfill.mts [days]

import { getSupabaseAdmin } from "../lib/supabase";
import { fetchTopPools, fetchHourlyVolume } from "../lib/sources/geckoterminal";
import { fetchLogs, fetchLatestBlockNumber, estimateBlockAtTimestamp } from "../lib/sources/blockscout";
import { LAUNCHPADS, decodeDeploymentLog } from "../lib/sources/launchpads";

const DAYS = parseInt(process.argv[2] || "7", 10);

function dateParts(timestampSec: number) {
  const d = new Date(timestampSec * 1000);
  return {
    snapshotDate: d.toISOString().slice(0, 10),
    dayOfWeek: d.getUTCDay(),
    hourOfDay: d.getUTCHours(),
  };
}

async function backfillVolume() {
  console.log(`\n[volume] fetching top pools...`);
  const pools = await fetchTopPools(5); // ~100 pools across all dexes
  console.log(`[volume] got ${pools.length} pools, pulling ${DAYS}d of hourly history each...`);

  // key: `${dexId}|${snapshotDate}|${hourOfDay}` -> summed volume
  const buckets = new Map<string, { dexId: string; snapshotDate: string; dayOfWeek: number; hourOfDay: number; volumeUsd: number }>();

  let done = 0;
  for (const pool of pools) {
    try {
      const candles = await fetchHourlyVolume(pool.poolAddress, DAYS * 24);
      for (const candle of candles) {
        const { snapshotDate, dayOfWeek, hourOfDay } = dateParts(candle.timestampSec);
        const key = `${pool.dexId}|${snapshotDate}|${hourOfDay}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.volumeUsd += candle.volumeUsd;
        } else {
          buckets.set(key, { dexId: pool.dexId, snapshotDate, dayOfWeek, hourOfDay, volumeUsd: candle.volumeUsd });
        }
      }
    } catch (e) {
      console.warn(`[volume] skipped pool ${pool.poolAddress}: ${(e as Error).message}`);
    }
    done++;
    if (done % 20 === 0) console.log(`[volume] processed ${done}/${pools.length} pools...`);
  }

  const rows = Array.from(buckets.values()).map((b) => ({
    feature: "volume",
    source: b.dexId,
    day_of_week: b.dayOfWeek,
    hour_of_day: b.hourOfDay,
    snapshot_date: b.snapshotDate,
    volume_usd: b.volumeUsd,
  }));

  console.log(`[volume] upserting ${rows.length} rows...`);
  const admin = getSupabaseAdmin();
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await admin.from("raw_snapshots").upsert(batch, {
      onConflict: "feature,source,snapshot_date,hour_of_day",
    });
    if (error) throw new Error(`[volume] upsert failed: ${error.message}`);
  }
  console.log(`[volume] done — ${rows.length} rows written.`);
}

async function backfillLaunches() {
  console.log(`\n[launch] estimating block range for last ${DAYS}d...`);
  const latest = await fetchLatestBlockNumber();
  const nowSec = Math.floor(Date.now() / 1000);
  const fromBlock = await estimateBlockAtTimestamp(nowSec - DAYS * 86400);
  console.log(`[launch] scanning blocks ${fromBlock} -> ${latest} (${latest - fromBlock} blocks) per launchpad`);

  const buckets = new Map<string, { source: string; snapshotDate: string; dayOfWeek: number; hourOfDay: number; count: number }>();

  for (const config of LAUNCHPADS) {
    console.log(`[launch] scanning ${config.id}...`);
    const logs = await fetchLogs(config.contractAddress, config.topic0, fromBlock, latest);
    console.log(`[launch] ${config.id}: ${logs.length} deploy events found`);
    for (const log of logs) {
      const decoded = decodeDeploymentLog(config.id, log);
      const { snapshotDate, dayOfWeek, hourOfDay } = dateParts(Math.floor(decoded.deployedAt.getTime() / 1000));
      const key = `${config.id}|${snapshotDate}|${hourOfDay}`;
      const existing = buckets.get(key);
      if (existing) existing.count++;
      else buckets.set(key, { source: config.id, snapshotDate, dayOfWeek, hourOfDay, count: 1 });
    }
  }

  const rows = Array.from(buckets.values()).map((b) => ({
    feature: "launch",
    source: b.source,
    day_of_week: b.dayOfWeek,
    hour_of_day: b.hourOfDay,
    snapshot_date: b.snapshotDate,
    deploy_count: b.count,
  }));

  console.log(`[launch] upserting ${rows.length} rows...`);
  const admin = getSupabaseAdmin();
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await admin.from("raw_snapshots").upsert(batch, {
      onConflict: "feature,source,snapshot_date,hour_of_day",
    });
    if (error) throw new Error(`[launch] upsert failed: ${error.message}`);
  }
  console.log(`[launch] done — ${rows.length} rows written.`);
}

async function main() {
  console.log(`=== Observo backfill: last ${DAYS} days ===`);
  await backfillVolume();
  await backfillLaunches();
  console.log(`\n=== Backfill complete ===`);
}

main().catch((e) => {
  console.error("BACKFILL FAILED:", e);
  process.exit(1);
});
