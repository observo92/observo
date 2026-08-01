// Public read endpoint for the homepage ticker tape.
//
// Launch numbers: sourced from Pons's own analytics endpoint (see
// fetchPonsAnalytics below), NOT from our own raw_snapshots.launch data.
// Our internal Blockscout-based launch scan (app/api/cron/raw-data) was
// found to badly undercount Pons activity — its 1.5h scan window issues
// getLogs() calls in parallel (Promise.all) against Blockscout's legacy
// API, which only tolerates ~1 request every couple seconds; concurrent
// calls get 403/429'd, and any timeout/failure silently drops that hour's
// data rather than partially saving it. Cross-checked directly against
// Blockscout logs: our stored total for Pons on 2026-07-29 was 96 events,
// while a single 50k-block sample from that same day alone returned 500+
// events. Pons's own dashboard (ponsfamily.com/analytics, backed by Dune)
// reports 24h launch counts in the thousands — consistent with the
// Blockscout sample, not with our stored number. Fixing the underlying
// scanner (sequential rate-limited calls + incremental sync_state
// checkpointing) is a separate, larger task; this fixes the immediate
// user-facing symptom (wildly wrong "busiest launchpad" ticker stat) by
// pointing at a reliable external source instead.
//
// Volume numbers: still sourced from our own raw_snapshots (GeckoTerminal
// pool data, not launch scanning) — that pipeline is unaffected by the
// Blockscout rate-limit issue above and has no known accuracy problem.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const revalidate = 0;

interface TickerItem {
  label: string;
  value: string;
  direction: "up" | "down" | "flat";
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

const SOURCE_LABELS: Record<string, string> = {
  "uniswap-v3-robinhood": "Uniswap V3",
  "uniswap-v2-robinhood": "Uniswap V2",
  "uniswap-v4-robinhood": "Uniswap V4",
  "pons-dot-family": "Pons",
  "dyorswap-robinhood": "DYORswap",
  flap: "flap.sh",
  pons: "Pons",
  bow: "bow.fun",
};

function sourceLabel(id: string): string {
  return SOURCE_LABELS[id] ?? id;
}

interface PonsAnalytics {
  totals: {
    launches24h: number;
    volumeUsd24h: number;
  };
  series?: Array<{ timestamp: number; launches: number; volumeUsd: number }>;
}

// Undocumented endpoint discovered via network inspection of Pons's own
// analytics page (it's what powers ponsfamily.com/analytics client-side),
// not an official published API. Could change or disappear without
// notice — always call this through the try/catch in GET() below and
// fall back to internal data if it fails.
async function fetchPonsAnalytics(): Promise<PonsAnalytics | null> {
  try {
    const res = await fetch("https://www.ponsfamily.com/api/pons-analytics?v=dune-v2", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as PonsAnalytics;
  } catch {
    return null;
  }
}

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: volToday }, ponsAnalytics] = await Promise.all([
    supabase
      .from("raw_snapshots")
      .select("source, volume_usd")
      .eq("feature", "volume")
      .eq("snapshot_date", today),
    fetchPonsAnalytics(),
  ]);

  const items: TickerItem[] = [];

  // Total volume today (our own DEX pool tracking) + top pool
  if (volToday && volToday.length > 0) {
    const bySource: Record<string, number> = {};
    let total = 0;
    for (const row of volToday) {
      const v = row.volume_usd ?? 0;
      total += v;
      bySource[row.source] = (bySource[row.source] ?? 0) + v;
    }
    items.push({ label: "DEX volume today", value: fmtUsd(total), direction: "flat" });

    const sorted = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      items.push({ label: "Top pool", value: `${sourceLabel(sorted[0][0])} · ${fmtUsd(sorted[0][1])}`, direction: "up" });
    }
  }

  // Pons launch/volume stats from their own analytics — see comment above
  // on why this isn't sourced from our own launch scanner.
  //
  // Sanity check found 2026-08-01: Pons's own totals.launches24h briefly
  // glitched to exactly 0 while volumeUsd24h stayed at its normal $62M+
  // level and every prior day in their own `series` array showed
  // 12,000-18,000+ launches/day -- a launchpad doing $62M/day in trading
  // volume genuinely having ZERO new launches that same day is not
  // plausible, so a bare 0 here is treated as a (likely upstream/Dune
  // sync) glitch rather than real data. Fall back to the most recent
  // non-zero day in their own `series` history instead of displaying 0.
  if (ponsAnalytics) {
    let launches24h = ponsAnalytics.totals.launches24h;
    if (launches24h === 0 && ponsAnalytics.totals.volumeUsd24h > 0 && ponsAnalytics.series) {
      const lastGoodDay = [...ponsAnalytics.series].reverse().find((d) => d.launches > 0);
      if (lastGoodDay) launches24h = lastGoodDay.launches;
    }
    items.push({ label: "Pons launches (24h)", value: `${launches24h.toLocaleString()}`, direction: "flat" });
    items.push({ label: "Pons volume (24h)", value: fmtUsd(ponsAnalytics.totals.volumeUsd24h), direction: "flat" });
  }


  return NextResponse.json({ items, generatedAt: new Date().toISOString() });
}
