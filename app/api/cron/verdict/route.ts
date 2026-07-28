// Hourly cron endpoint (single verdict). Generates and stores ONE
// (feature, mode) verdict for the CURRENT hour-of-week slot, chosen via
// query params, e.g. /api/cron/verdict?feature=volume&mode=trader.
//
// Split out from the old combined /api/cron/tick route (which generated
// all 4 combos sequentially in one request) because Vercel Hobby plan caps
// function duration at 60s and that combined run took too long. Call this
// route 4 times per hour (once per combo below) from the external
// scheduler (cron-job.org), ideally staggered a few minutes apart so the
// Groq free-tier per-minute token cap isn't tripped.
//
// Protected by CRON_SECRET so it can't be triggered by random requests.

import { NextRequest, NextResponse } from "next/server";
import { generateAndStoreVerdict } from "@/lib/ai/store";

export const maxDuration = 60; // Hobby plan cap

function currentSlot() {
  const now = new Date();
  return { dayOfWeek: now.getUTCDay(), hourOfDay: now.getUTCHours() };
}

const VALID_FEATURES = ["volume", "launch"] as const;
const VALID_MODES = ["trader", "deployer"] as const;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const feature = searchParams.get("feature");
  const mode = searchParams.get("mode");

  if (!VALID_FEATURES.includes(feature as (typeof VALID_FEATURES)[number])) {
    return NextResponse.json({ error: `invalid or missing 'feature' query param, expected one of ${VALID_FEATURES.join(", ")}` }, { status: 400 });
  }
  if (!VALID_MODES.includes(mode as (typeof VALID_MODES)[number])) {
    return NextResponse.json({ error: `invalid or missing 'mode' query param, expected one of ${VALID_MODES.join(", ")}` }, { status: 400 });
  }

  const { dayOfWeek, hourOfDay } = currentSlot();
  const key = `${feature}/${mode}`;

  try {
    await generateAndStoreVerdict(feature as "volume" | "launch", mode as "trader" | "deployer", dayOfWeek, hourOfDay);
    return NextResponse.json({ dayOfWeek, hourOfDay, [key]: "ok" });
  } catch (e) {
    return NextResponse.json({ dayOfWeek, hourOfDay, [key]: `error: ${(e as Error).message}` }, { status: 500 });
  }
}
