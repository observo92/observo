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
// raw_snapshots accumulates one row per (feature, source, snapshot_date,
// hour_of_day) — every week's data for a given hour-of-week slot is kept,
// never deleted. This is what lets confidence (lib/ai/tools.ts
// getSampleConfidence, based on distinct snapshot_date count for a slot)
// actually grow over time instead of being stuck at 1-2 days forever. An
// earlier version of this file deleted prior weeks' rows for a slot before
// writing the current one, out of a (mistaken) concern that the AI's SUM-
// based tool would see inflated totals as weeks piled up — but the tools
// already compute `average` (total / distinct days), which is what the AI
// is instructed to reason from, so accumulating history is safe and in
// fact required for confidence to mean anything.
//
// Protected by CRON_SECRET so it can't be triggered by random requests.

import { NextRequest, NextResponse } from "next/server";
import { fetchTopPools } from "@/lib/sources/geckoterminal";
import { fetchLogs, fetchLatestBlockNumber, estimateBlockAtTimestamp } from "@/lib/sources/blockscout";
import { LAUNCHPADS, decodeDeploymentLog } from "@/lib/sources/launchpads";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60; // Hobby plan cap

// The cron runs at minute 0 of every hour, but the hour that just STARTED
// hasn't happened yet -- there's no data for it. What we actually want to
// record is the hour that just FINISHED (e.g. a run at 14:00 should record
// data for the 13:00-14:00 slot). Using the current in-progress hour was a
// bug: launch counts were near-zero (the filter only matched the handful of
// seconds elapsed since the hour began) and volume was mislabeled a full
// hour off (GeckoTerminal's volume_usd.h1 is a trailing last-60-min window,
// which corresponds to the hour that just ended, not the one just starting).
function targetSlot() {
  const now = new Date();
  const prevHourDate = new Date(now.getTime() - 60 * 60 * 1000);
  return {
    dayOfWeek: prevHourDate.getUTCDay(),
    hourOfDay: prevHourDate.getUTCHours(),
    snapshotDate: prevHourDate.toISOString().slice(0, 10),
  };
}

async function refreshVolume() {
  const { dayOfWeek, hourOfDay, snapshotDate } = targetSlot();
  const admin = getSupabaseAdmin();

  // Single page (20 pools) is enough to cover Robinhood Chain's current
  // pool count, and the /pools response already includes each pool's
  // volume_usd.h1 (rolling last-hour volume) — no separate /ohlcv/hour
  // call needed per pool. Keeps this to exactly one GeckoTerminal request
  // per run, which matters given its aggressive free-tier rate limit.
  const pools = await fetchTopPools(1);
  const volumeBuckets = new Map<string, number>();
  for (const pool of pools) {
    volumeBuckets.set(pool.dexId, (volumeBuckets.get(pool.dexId) ?? 0) + pool.volume1hUsd);
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
    // Upsert only — see the file header comment on why prior weeks' rows
    // for this slot are intentionally NOT deleted.
    await admin.from("raw_snapshots").upsert(volumeRows, { onConflict: "feature,source,snapshot_date,hour_of_day" });
  }
}

async function refreshLaunch() {
  const { dayOfWeek, hourOfDay, snapshotDate } = targetSlot();
  const admin = getSupabaseAdmin();

  // Scan from ~1.5h before the target hour's start (comfortable margin in
  // case a run is delayed) up to the current chain head — the target hour
  // already fully elapsed, so the chain head is guaranteed to be past it.
  const latest = await fetchLatestBlockNumber();
  const now = new Date();
  const fromBlock = await estimateBlockAtTimestamp(Math.floor(now.getTime() / 1000) - 2 * 3600 - 1800);
  const launchCounts = new Map<string, number>();
  for (const config of LAUNCHPADS) {
    const logs = await fetchLogs(config.contractAddress, config.topic0, fromBlock, latest);
    for (const log of logs) {
      const decoded = decodeDeploymentLog(config.id, log);
      // Only count events that actually fall in the target UTC hour bucket.
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
    // Upsert only — see the file header comment on why prior weeks' rows
    // for this slot are intentionally NOT deleted.
    await admin.from("raw_snapshots").upsert(launchRows, { onConflict: "feature,source,snapshot_date,hour_of_day" });
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { dayOfWeek, hourOfDay } = targetSlot();
  const results: Record<string, string> = {};

  // Hard per-task deadline so a slow/rate-limited upstream (GeckoTerminal or
  // Blockscout) can never make the whole function exceed Vercel's 60s cap —
  // whichever task is still pending past 45s is abandoned and reported as a
  // timeout rather than dragging the other task's already-settled result
  // down with it.
  function withDeadline<T>(promise: Promise<T>, label: string, ms = 45_000): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms deadline`)), ms)),
    ]);
  }

  const [volumeResult, launchResult] = await Promise.allSettled([
    withDeadline(refreshVolume(), "refreshVolume"),
    withDeadline(refreshLaunch(), "refreshLaunch"),
  ]);
  results.volume = volumeResult.status === "fulfilled" ? "ok" : `error: ${(volumeResult.reason as Error).message}`;
  results.launch = launchResult.status === "fulfilled" ? "ok" : `error: ${(launchResult.reason as Error).message}`;

  const anyOk = results.volume === "ok" || results.launch === "ok";
  return NextResponse.json({ dayOfWeek, hourOfDay, results }, { status: anyOk ? 200 : 500 });
}
