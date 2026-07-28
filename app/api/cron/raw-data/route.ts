// Hourly cron endpoint (data only). Refreshes raw_snapshots for the CURRENT
// hour-of-week slot. Split out from the old combined /api/cron/tick route
// because Vercel Hobby plan caps function duration at 60s, and fetching
// fresh data + generating 4 AI verdicts sequentially exceeded that. This
// route should be triggered first (or at least around the same time as)
// the four /api/cron/verdict?feature=..&mode=.. routes each hour.
//
// Volume (GeckoTerminal) and launch (Blockscout) refreshes run and report
// independently — a GeckoTerminal rate limit / outage must not prevent the
// unrelated Blockscout launch data from being refreshed, and vice versa.
//
// IMPORTANT: raw_snapshots is intentionally NOT allowed to accumulate
// multiple weeks for the same (feature, source, day_of_week, hour_of_day)
// slot. Before writing this hour's fresh numbers, any older snapshot rows
// for that exact slot (different snapshot_date, same day-of-week/hour) are
// deleted first. Otherwise the AI's tools (which SUM across all rows for a
// slot) would see volume/launch counts inflated by old weeks piling up,
// making a slot look "busier" than it actually is right now.
//
// Protected by CRON_SECRET so it can't be triggered by random requests.

import { NextRequest, NextResponse } from "next/server";
import { fetchTopPools, fetchHourlyVolume } from "@/lib/sources/geckoterminal";
import { fetchLogs, fetchLatestBlockNumber, estimateBlockAtTimestamp } from "@/lib/sources/blockscout";
import { LAUNCHPADS, decodeDeploymentLog } from "@/lib/sources/launchpads";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60; // Hobby plan cap

function currentSlot() {
  const now = new Date();
  return { dayOfWeek: now.getUTCDay(), hourOfDay: now.getUTCHours() };
}

async function refreshVolume() {
  const now = new Date();
  const snapshotDate = now.toISOString().slice(0, 10);
  const { dayOfWeek, hourOfDay } = currentSlot();
  const admin = getSupabaseAdmin();

  // Only the top 2 pools, most recent candle only (limit=1) — this cron
  // runs every hour, so we only need this hour's data. Kept small on
  // purpose to stay well inside the 60s function budget even when
  // GeckoTerminal's free tier is slow/rate-limited.
  const pools = await fetchTopPools(2);
  const volumeBuckets = new Map<string, number>();
  for (const pool of pools) {
    try {
      const candles = await fetchHourlyVolume(pool.poolAddress, 1);
      if (candles.length > 0) {
        volumeBuckets.set(pool.dexId, (volumeBuckets.get(pool.dexId) ?? 0) + candles[0].volumeUsd);
      }
    } catch {
      // one bad pool shouldn't abort the whole hourly refresh
    }
  }
  const volumeRows = Array.from(volumeBuckets.entries()).map(([dexId, volumeUsd]) => ({
    feature: "volume",
    source: dexId,
    day_of_week: dayOfWeek,
    hour_of_day: hourOfDay,
    snapshot_date: snapshotDate,
    volume_usd: volumeUsd,
  }));
  if (volumeRows.length > 0) {
    // Wipe any prior week's snapshot for this exact slot before writing the
    // fresh one, so raw_snapshots never holds more than the latest week per slot.
    await admin
      .from("raw_snapshots")
      .delete()
      .eq("feature", "volume")
      .eq("day_of_week", dayOfWeek)
      .eq("hour_of_day", hourOfDay)
      .neq("snapshot_date", snapshotDate);
    await admin.from("raw_snapshots").upsert(volumeRows, { onConflict: "feature,source,snapshot_date,hour_of_day" });
  }
}

async function refreshLaunch() {
  const now = new Date();
  const snapshotDate = now.toISOString().slice(0, 10);
  const { dayOfWeek, hourOfDay } = currentSlot();
  const admin = getSupabaseAdmin();

  // Scan only the last ~1.5h of blocks (comfortable margin over the 1h
  // cron interval in case a run is delayed), not the whole chain.
  const latest = await fetchLatestBlockNumber();
  const fromBlock = await estimateBlockAtTimestamp(Math.floor(now.getTime() / 1000) - 5400);
  const launchCounts = new Map<string, number>();
  for (const config of LAUNCHPADS) {
    const logs = await fetchLogs(config.contractAddress, config.topic0, fromBlock, latest);
    for (const log of logs) {
      const decoded = decodeDeploymentLog(config.id, log);
      // Only count events that actually fall in the current UTC hour bucket.
      if (decoded.deployedAt.getUTCHours() === hourOfDay && decoded.deployedAt.toISOString().slice(0, 10) === snapshotDate) {
        launchCounts.set(config.id, (launchCounts.get(config.id) ?? 0) + 1);
      }
    }
  }
  const launchRows = Array.from(launchCounts.entries()).map(([source, deployCount]) => ({
    feature: "launch",
    source,
    day_of_week: dayOfWeek,
    hour_of_day: hourOfDay,
    snapshot_date: snapshotDate,
    deploy_count: deployCount,
  }));
  if (launchRows.length > 0) {
    // Same "no cross-week accumulation" rule as volume above.
    await admin
      .from("raw_snapshots")
      .delete()
      .eq("feature", "launch")
      .eq("day_of_week", dayOfWeek)
      .eq("hour_of_day", hourOfDay)
      .neq("snapshot_date", snapshotDate);
    await admin.from("raw_snapshots").upsert(launchRows, { onConflict: "feature,source,snapshot_date,hour_of_day" });
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { dayOfWeek, hourOfDay } = currentSlot();
  const results: Record<string, string> = {};

  const [volumeResult, launchResult] = await Promise.allSettled([refreshVolume(), refreshLaunch()]);
  results.volume = volumeResult.status === "fulfilled" ? "ok" : `error: ${(volumeResult.reason as Error).message}`;
  results.launch = launchResult.status === "fulfilled" ? "ok" : `error: ${(launchResult.reason as Error).message}`;

  const anyOk = results.volume === "ok" || results.launch === "ok";
  return NextResponse.json({ dayOfWeek, hourOfDay, results }, { status: anyOk ? 200 : 500 });
}
