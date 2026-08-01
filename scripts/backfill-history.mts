// One-off backfill script: re-fetches real historical data directly from
// each upstream source (GeckoTerminal for volume, Blockscout for launch
// events) and inserts it into raw_snapshots with correct historical
// snapshot_dates. This is NOT an "undelete" — it's a fresh re-fetch from
// the origin, which is what makes it possible at all (the origin sources
// still hold this history even though our own DB previously deleted it
// each week — see the raw-data cron fix in the same PR/session).
//
// Run with: npx tsx -r dotenv/config scripts/backfill-history.mts
//
// Resumable: progress (which day/hour/launchpad has been completed) is
// written to /tmp/backfill-progress.json after every unit of work, so if
// this process is interrupted, re-running it skips everything already done
// instead of starting over. Safe to Ctrl-C and re-run at any time.
//
// IMPORTANT (rate limiting): unlike the existing lib/sources/blockscout.ts
// fetchLogs(), which recursively splits large ranges via Promise.all()
// (i.e. CONCURRENT requests), this script deliberately calls Blockscout
// getLogs SEQUENTIALLY with a fixed delay between every single call.
// Empirically confirmed earlier in this session: Blockscout's legacy
// getLogs API 429s/403s almost immediately on concurrent requests, but
// tolerates sequential calls fine with a >=2s gap. This script uses 2.5s.

import { getSupabaseAdmin } from "../lib/supabase";
import { LAUNCHPADS, decodeDeploymentLog } from "../lib/sources/launchpads";
import { fetchLatestBlockNumber } from "../lib/sources/blockscout";
import * as fs from "fs";

const BACKFILL_DAYS = 14;
const PROGRESS_FILE = "/tmp/backfill-progress.json";
const BLOCKSCOUT_GAP_MS = 2500;
const CHUNK_BLOCKS = 20000;
const AVG_BLOCK_TIME_SEC = 1 / 9.97; // empirically measured this session, ~9.97 blocks/sec

interface Progress {
  volumeDone: boolean;
  launchLastToBlock: Record<string, number>; // launchpad id -> highest toBlock fully processed
  launchStartBlock: number | null;
  launchEndBlock: number | null;
}

function loadProgress(): Progress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return { volumeDone: false, launchLastToBlock: {}, launchStartBlock: null, launchEndBlock: null };
}

function saveProgress(p: Progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ---------- Volume backfill (GeckoTerminal) ----------

async function backfillVolume(progress: Progress) {
  if (progress.volumeDone) {
    log("Volume backfill already done, skipping.");
    return;
  }

  const admin = getSupabaseAdmin();
  const BASE = "https://api.geckoterminal.com/api/v2";
  const NETWORK = "robinhood";

  log("Fetching pool list...");
  let poolsRes: Response | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    poolsRes = await fetch(`${BASE}/networks/${NETWORK}/pools?page=1`, {
      headers: { Accept: "application/json" },
    });
    if (poolsRes.status !== 429 && poolsRes.status < 500) break;
    const waitMs = 5000 * (attempt + 1);
    log(`  retry ${attempt + 1}/8 for pool list (waiting ${waitMs}ms)...`);
    await sleep(waitMs);
  }
  if (!poolsRes || !poolsRes.ok) throw new Error(`pools fetch failed: HTTP ${poolsRes?.status}`);
  const poolsJson = await poolsRes.json();
  const pools: { address: string; dexId: string }[] = poolsJson.data.map((p: any) => ({
    address: p.attributes.address,
    dexId: p.relationships.dex.data.id,
  }));
  log(`Found ${pools.length} pools.`);

  const cutoffSec = Math.floor(Date.now() / 1000) - BACKFILL_DAYS * 86400;

  // rows keyed by (source, snapshot_date, hour_of_day) -> summed volume_usd
  const bucket = new Map<string, { source: string; snapshot_date: string; day_of_week: number; hour_of_day: number; volume_usd: number }>();

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    log(`[${i + 1}/${pools.length}] Fetching hourly OHLCV for ${pool.address} (${pool.dexId})...`);
    let res: Response | undefined;
    // GeckoTerminal's free tier rate-limits hard — empirically confirmed
    // mid-run that even a ~700ms gap between calls hits 429 consistently,
    // while a 3s+ gap does not. Retry with real backoff (not a token-bucket
    // guess) rather than silently skipping a pool's data on failure — a
    // skipped pool would just quietly under-report volume for that dex,
    // the same class of bug this whole backfill exists to fix.
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        res = await fetch(`${BASE}/networks/${NETWORK}/pools/${pool.address}/ohlcv/hour?limit=1000`, {
          headers: { Accept: "application/json" },
        });
        if (res.status !== 429 && res.status < 500) break;
      } catch {
        res = undefined;
      }
      const waitMs = 5000 * (attempt + 1);
      log(`  retry ${attempt + 1}/8 for ${pool.address} (waiting ${waitMs}ms)...`);
      await sleep(waitMs);
    }
    if (!res || !res.ok) {
      log(`  ERROR: exhausted retries for ${pool.address}, skipping (this pool's volume will be missing from backfill).`);
      continue;
    }
    const json = await res.json();
    const candles: [number, number, number, number, number, number][] = json.data?.attributes?.ohlcv_list || [];
    let kept = 0;
    for (const [ts, , , , , volume] of candles) {
      if (ts < cutoffSec) continue;
      const d = new Date(ts * 1000);
      const snapshotDate = d.toISOString().slice(0, 10);
      const dayOfWeek = d.getUTCDay();
      const hourOfDay = d.getUTCHours();
      const key = `${pool.dexId}|${snapshotDate}|${hourOfDay}`;
      const existing = bucket.get(key);
      if (existing) {
        existing.volume_usd += volume;
      } else {
        bucket.set(key, { source: pool.dexId, snapshot_date: snapshotDate, day_of_week: dayOfWeek, hour_of_day: hourOfDay, volume_usd: volume });
      }
      kept++;
    }
    log(`  kept ${kept} candles within ${BACKFILL_DAYS}d window.`);
    await sleep(3500); // safe gap empirically confirmed this session
  }

  const rows = Array.from(bucket.values()).map((r) => ({ feature: "volume", ...r }));
  log(`Writing ${rows.length} volume rows to raw_snapshots...`);
  // Upsert in batches of 500 to avoid oversized payloads.
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await admin.from("raw_snapshots").upsert(batch, { onConflict: "feature,source,snapshot_date,hour_of_day" });
    if (error) throw new Error(`volume upsert batch ${i} failed: ${error.message}`);
  }
  log("Volume backfill complete.");

  progress.volumeDone = true;
  saveProgress(progress);
}

// ---------- Launch backfill (Blockscout, sequential rate-limited) ----------

async function fetchLogsSequentialChunk(
  address: string,
  topic0: string,
  fromBlock: number,
  toBlock: number
): Promise<any[]> {
  const LEGACY_API_BASE = "https://robinhoodchain.blockscout.com/api";
  const url = new URL(LEGACY_API_BASE);
  url.searchParams.set("module", "logs");
  url.searchParams.set("action", "getLogs");
  url.searchParams.set("address", address);
  url.searchParams.set("topic0", topic0);
  url.searchParams.set("fromBlock", String(fromBlock));
  url.searchParams.set("toBlock", String(toBlock));

  for (let attempt = 0; attempt < 6; attempt++) {
    let res: Response | undefined;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      res = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: controller.signal });
      clearTimeout(timeout);
    } catch {
      res = undefined;
    }
    if (res && res.ok) {
      const json = await res.json();
      if (json.status === "0") {
        if (json.message === "No logs found") return [];
        throw new Error(`Blockscout error: ${json.message}`);
      }
      const result = Array.isArray(json.result) ? json.result : [];
      if (result.length >= 1000) {
        // Truncated — split this chunk into two halves recursively, still sequential.
        const mid = Math.floor((fromBlock + toBlock) / 2);
        if (mid <= fromBlock) return result;
        await sleep(BLOCKSCOUT_GAP_MS);
        const left = await fetchLogsSequentialChunk(address, topic0, fromBlock, mid);
        await sleep(BLOCKSCOUT_GAP_MS);
        const right = await fetchLogsSequentialChunk(address, topic0, mid + 1, toBlock);
        return [...left, ...right];
      }
      return result;
    }
    // 429/403/5xx — back off and retry.
    log(`  retry ${attempt + 1}/6 for [${fromBlock}-${toBlock}] (HTTP ${res?.status ?? "no response"})`);
    await sleep(3000 * (attempt + 1));
  }
  throw new Error(`fetchLogsSequentialChunk exhausted retries for [${fromBlock}-${toBlock}]`);
}

async function backfillLaunch(progress: Progress) {
  const admin = getSupabaseAdmin();
  const cutoffSec = Math.floor(Date.now() / 1000) - BACKFILL_DAYS * 86400;

  const latest = await fetchLatestBlockNumber();
  if (progress.launchEndBlock === null) {
    progress.launchEndBlock = latest;
    const secondsAgo = Math.floor(Date.now() / 1000) - cutoffSec;
    const blocksAgo = Math.round(secondsAgo / AVG_BLOCK_TIME_SEC);
    progress.launchStartBlock = Math.max(0, latest - blocksAgo);
    saveProgress(progress);
  }

  const startBlock = progress.launchStartBlock!;
  const endBlock = progress.launchEndBlock!;
  log(`Launch backfill range: ${startBlock} -> ${endBlock} (${endBlock - startBlock} blocks)`);

  for (const config of LAUNCHPADS) {
    let cursor = progress.launchLastToBlock[config.id] ?? startBlock - 1;
    if (cursor >= endBlock) {
      log(`${config.id}: already fully processed, skipping.`);
      continue;
    }

    // bucket per (source, snapshot_date, hour_of_day) -> count, accumulated
    // per launchpad and flushed to DB after each chunk (so progress persists
    // incrementally, not just at the very end).
    while (cursor < endBlock) {
      const chunkFrom = cursor + 1;
      const chunkTo = Math.min(chunkFrom + CHUNK_BLOCKS - 1, endBlock);
      log(`${config.id}: scanning [${chunkFrom}-${chunkTo}] (${Math.round(((chunkFrom - startBlock) / (endBlock - startBlock)) * 100)}% through range)...`);

      const logs = await fetchLogsSequentialChunk(config.contractAddress, config.topic0, chunkFrom, chunkTo);
      log(`${config.id}: got ${logs.length} events in this chunk.`);

      const bucket = new Map<string, { day_of_week: number; hour_of_day: number; snapshot_date: string; count: number }>();
      for (const rawLog of logs) {
        try {
          const decoded = decodeDeploymentLog(config.id, rawLog, parseInt(rawLog.timeStamp, 16));
          const d = decoded.deployedAt;
          const snapshotDate = d.toISOString().slice(0, 10);
          const key = `${snapshotDate}|${d.getUTCHours()}`;
          const existing = bucket.get(key);
          if (existing) existing.count++;
          else bucket.set(key, { day_of_week: d.getUTCDay(), hour_of_day: d.getUTCHours(), snapshot_date: snapshotDate, count: 1 });
        } catch (e) {
          log(`  WARN: failed to decode a log: ${(e as Error).message}`);
        }
      }

      if (bucket.size > 0) {
        const rows = Array.from(bucket.values()).map((b) => ({
          feature: "launch",
          source: config.id,
          day_of_week: b.day_of_week,
          hour_of_day: b.hour_of_day,
          snapshot_date: b.snapshot_date,
          deploy_count: b.count,
        }));
        // Merge with any existing row for the same slot (upsert overwrites,
        // so first read existing deploy_count and add to it in case this
        // hour/date was already touched by a prior chunk or the live cron).
        for (const row of rows) {
          const { data: existingRow } = await admin
            .from("raw_snapshots")
            .select("deploy_count")
            .eq("feature", "launch")
            .eq("source", config.id)
            .eq("snapshot_date", row.snapshot_date)
            .eq("hour_of_day", row.hour_of_day)
            .maybeSingle();
          const newCount = (existingRow?.deploy_count ?? 0) + row.deploy_count;
          const { error } = await admin
            .from("raw_snapshots")
            .upsert({ ...row, deploy_count: newCount }, { onConflict: "feature,source,snapshot_date,hour_of_day" });
          if (error) throw new Error(`launch upsert failed: ${error.message}`);
        }
      }

      cursor = chunkTo;
      progress.launchLastToBlock[config.id] = cursor;
      saveProgress(progress);

      await sleep(BLOCKSCOUT_GAP_MS);
    }
    log(`${config.id}: DONE.`);
  }
}

async function main() {
  log(`=== Starting backfill (${BACKFILL_DAYS} days) ===`);
  const progress = loadProgress();

  await backfillVolume(progress);
  await backfillLaunch(progress);

  log("=== Backfill complete ===");
}

main().catch((e) => {
  console.error("BACKFILL FAILED:", e);
  process.exit(1);
});
