// Public read endpoint for the homepage ticker tape — small, cheap
// aggregates over raw_snapshots (real numbers, not invented placeholders).
// Reads via the anon-key client so it respects the same RLS policy as
// the heatmap endpoint. Recomputed fresh on every request; the underlying
// table is small enough that this doesn't need caching yet.

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

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: volToday }, { data: launchToday }, { data: volYesterdaySameHour }] = await Promise.all([
    supabase
      .from("raw_snapshots")
      .select("source, volume_usd")
      .eq("feature", "volume")
      .eq("snapshot_date", today),
    supabase
      .from("raw_snapshots")
      .select("source, deploy_count")
      .eq("feature", "launch")
      .eq("snapshot_date", today),
    supabase
      .from("raw_snapshots")
      .select("volume_usd, snapshot_date")
      .eq("feature", "volume")
      .order("snapshot_date", { ascending: false })
      .limit(200),
  ]);

  const items: TickerItem[] = [];

  // Total volume today + top source
  if (volToday && volToday.length > 0) {
    const bySource: Record<string, number> = {};
    let total = 0;
    for (const row of volToday) {
      const v = row.volume_usd ?? 0;
      total += v;
      bySource[row.source] = (bySource[row.source] ?? 0) + v;
    }
    items.push({ label: "Volume today", value: fmtUsd(total), direction: "flat" });

    const sorted = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      items.push({ label: "Top pool", value: `${sourceLabel(sorted[0][0])} · ${fmtUsd(sorted[0][1])}`, direction: "up" });
    }
  }

  // Total launches today + top launchpad
  if (launchToday && launchToday.length > 0) {
    const bySource: Record<string, number> = {};
    let total = 0;
    for (const row of launchToday) {
      const v = row.deploy_count ?? 0;
      total += v;
      bySource[row.source] = (bySource[row.source] ?? 0) + v;
    }
    items.push({ label: "Launches today", value: `${Math.round(total)}`, direction: "flat" });

    const sorted = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      items.push({ label: "Busiest launchpad", value: `${sourceLabel(sorted[0][0])} · ${Math.round(sorted[0][1])}`, direction: "flat" });
    }
  }

  // Distinct days of history collected (confidence signal)
  if (volYesterdaySameHour) {
    const distinctDates = new Set(volYesterdaySameHour.map((r) => r.snapshot_date));
    items.push({ label: "Days of history", value: `${distinctDates.size}`, direction: "flat" });
  }

  return NextResponse.json({ items, generatedAt: new Date().toISOString() });
}
