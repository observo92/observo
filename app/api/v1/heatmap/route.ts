// Public read endpoint — returns the full 7x24 verdict grid for a given
// feature+mode, used by both the frontend heatmap page and any external
// bots/agents (documented on /api-docs). Reads via the anon-key client so
// it respects the same RLS policy any other consumer would.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const feature = searchParams.get("feature") ?? "volume";
  const mode = searchParams.get("mode") ?? "trader";

  if (!["volume", "launch"].includes(feature)) {
    return NextResponse.json({ error: "feature must be 'volume' or 'launch'" }, { status: 400 });
  }
  if (!["trader", "deployer"].includes(mode)) {
    return NextResponse.json({ error: "mode must be 'trader' or 'deployer'" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("verdicts")
    .select("day_of_week, hour_of_day, score, confidence, reasoning, raw_stats, payload_hash, signature, signed_at")
    .eq("feature", feature)
    .eq("mode", mode);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    feature,
    mode,
    grid: data,
    publicKey: process.env.NEXT_PUBLIC_OBSERVO_SIGNING_PUBLIC_KEY,
  });
}
