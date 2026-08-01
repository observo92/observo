"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { VerdictCell } from "@/lib/types";
import Ticker from "@/components/Ticker";
import { useHeatmapTooltip, HeatmapTooltip } from "@/components/HeatmapTooltip";

type Feature = "volume" | "launch";
type Mode = "trader" | "deployer";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Black -> bright green scale, darker score = quieter, brighter = peak.
function scoreColor(score: number): string {
  if (score <= 1) return "#141d16";
  if (score <= 3) return "#1c3a24";
  if (score <= 5) return "#256b38";
  if (score <= 7) return "#2fa350";
  return "#3ecb63"; // peak — also gets the pulse animation
}

function cellKey(day: number, hour: number): string {
  return `${day}-${hour}`;
}

const TAGS_TRADER = { good: "Good time to buy", ok: "Okay, nothing special", bad: "Maybe wait a bit" };
const TAGS_DEPLOYER = { good: "Good time to launch", ok: "Average competition", bad: "Too crowded right now" };

function hourLabel(hour: number): string {
  const d = new Date(Date.UTC(2026, 0, 1, hour));
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" });
}

function shortHourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

function formatStat(cell: VerdictCell | undefined, feature: Feature): string | null {
  const total = cell?.raw_stats?.total;
  if (total === undefined || total === null) return null;
  if (feature === "volume") {
    if (total >= 1_000_000) return `$${(total / 1_000_000).toFixed(1)}M volume`;
    if (total >= 1_000) return `$${(total / 1_000).toFixed(1)}K volume`;
    return `$${Math.round(total)} volume`;
  }
  const count = Math.round(total);
  return `${count} launch${count === 1 ? "" : "es"}`;
}

// Short plain-English note for the tooltip, distinct from the fuller
// `reasoning` text shown in the detail panel below the grid.
function tooltipNote(cell: VerdictCell | undefined): string {
  if (!cell) return "No data yet for this hour";
  if (cell.score >= 8) return "Peak activity — expect it busy";
  if (cell.score >= 6) return "Getting crowded";
  if (cell.score >= 3) return "Steady, average activity";
  return "Quiet stretch";
}

const OBI_CHECKLIST = ["Scans every launch", "Monitors liquidity", "Detects unusual activity", "Generates the AI verdict"];

const SCAN_MESSAGES = [
  "Watching pools across Robinhood Chain...",
  "Reading liquidity depth...",
  "Cross-checking sources...",
  "Looking for abnormal volume...",
];

export default function Home() {
  const [tab, setTab] = useState<Feature>("volume");
  const [mode, setMode] = useState<Mode>("trader");
  const [grid, setGrid] = useState<VerdictCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<VerdictCell | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [scanIdx, setScanIdx] = useState(0);
  const tooltip = useHeatmapTooltip();

  // Rotating "Obi is working" messages for the empty-state (no verdict yet
  // for the current hour) so it reads as an active AI scanning, not a dead
  // "still gathering data" sentence.
  useEffect(() => {
    const id = setInterval(() => setScanIdx((i) => (i + 1) % SCAN_MESSAGES.length), 2200);
    return () => clearInterval(id);
  }, []);

  const now = useMemo(() => new Date(), []);
  const nowDay = now.getUTCDay();
  const nowHour = now.getUTCHours();

  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/heatmap?feature=${tab}&mode=${mode}`)
      .then((r) => r.json())
      .then((data) => {
        const newGrid: VerdictCell[] = data.grid ?? [];
        setGrid(newGrid);
        // Auto-select the current hour's cell so its full detail (reasoning,
        // score, confidence, verify signature) is visible immediately on
        // load, instead of requiring the user to click a cell first.
        const nowCell = newGrid.find(
          (c) => c.day_of_week === nowDay && c.hour_of_day === nowHour
        );
        setSelected(nowCell ?? null);
        setWhyOpen(false);
      })
      .finally(() => setLoading(false));
  }, [tab, mode, nowDay, nowHour]);

  const byKey = useMemo(() => {
    const map = new Map<string, VerdictCell>();
    for (const cell of grid) map.set(cellKey(cell.day_of_week, cell.hour_of_day), cell);
    return map;
  }, [grid]);

  const currentCell = byKey.get(cellKey(nowDay, nowHour));

  function openCell(cell: VerdictCell | undefined) {
    if (!cell) return;
    setSelected(cell);
    setWhyOpen(false);
    setVerifyState("idle");
  }

  function cellTitle(day: number, hour: number): string {
    return `${DAYS[day]} · ${shortHourLabel(hour)}`;
  }

  // Hover for mouse users; tap-to-toggle for touch (no native hover) —
  // both funnel into the same tooltip state so the interaction feels
  // consistent regardless of device.
  function onCellEnter(e: React.MouseEvent, day: number, hour: number, cell: VerdictCell | undefined) {
    tooltip.show(e.clientX, e.clientY, cellTitle(day, hour), tooltipNote(cell));
  }
  function onCellMove(e: React.MouseEvent) {
    tooltip.move(e.clientX, e.clientY);
  }
  function onCellLeave() {
    tooltip.hide();
  }
  function onCellTouch(e: React.TouchEvent, day: number, hour: number, cell: VerdictCell | undefined) {
    const t = e.touches[0] ?? e.changedTouches[0];
    if (t) tooltip.show(t.clientX, t.clientY, cellTitle(day, hour), tooltipNote(cell));
    openCell(cell);
  }

  async function toggleWhy() {
    if (!selected) return;
    const next = !whyOpen;
    setWhyOpen(next);
    if (!next) return;

    setVerifyState("checking");
    try {
      const res = await fetch("/api/v1/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash: selected.payload_hash, signature: selected.signature }),
      });
      const data = await res.json();
      setVerifyState(data.valid ? "valid" : "invalid");
    } catch {
      setVerifyState("invalid");
    }
  }

  const tags = mode === "trader" ? TAGS_TRADER : TAGS_DEPLOYER;
  const tagFor = (score: number) => {
    if (score >= 7) return { text: tags.good, cls: "bg-emerald-500/10 text-emerald-400" };
    if (score >= 4) return { text: tags.ok, cls: "bg-gray-800 text-gray-400" };
    return { text: tags.bad, cls: "bg-amber-500/10 text-amber-400" };
  };

  function verdictHeadline(): { html: string } {
    const score = currentCell?.score ?? 0;
    if (!currentCell) {
      return { html: `<span class="scan-msg">${SCAN_MESSAGES[scanIdx]}</span>` };
    }
    if (tab === "volume") {
      if (score >= 7) return { html: `Volume's <b class="text-emerald-400">building fast</b> — ${currentCell.reasoning}` };
      if (score >= 4) return { html: `Right now is <b class="text-gray-300">fairly average</b> — ${currentCell.reasoning}` };
      return { html: `Right now looks <b class="text-amber-400">a bit quiet</b> — ${currentCell.reasoning}` };
    } else {
      if (score >= 7) return { html: `Right now looks <b class="text-emerald-400">good for launching</b> — ${currentCell.reasoning}` };
      if (score >= 4) return { html: `Right now is <b class="text-gray-300">a normal window</b> — ${currentCell.reasoning}` };
      return { html: `Right now is <b class="text-amber-400">pretty crowded</b> — ${currentCell.reasoning}` };
    }
  }

  const confidencePct = currentCell
    ? currentCell.confidence === "high"
      ? 92
      : currentCell.confidence === "medium"
      ? 65
      : 32
    : 0;

  const scannedStat = formatStat(currentCell, tab);
  const sourceCount = currentCell?.raw_stats?.bySource ? Object.keys(currentCell.raw_stats.bySource).length : 0;

  return (
    <div className="relative z-[1] max-w-4xl mx-auto px-5 py-6 flex-1 w-full">
      <div className="flex items-center justify-between mb-8 gap-3 flex-wrap">
        <p className="text-sm text-gray-400 max-w-[26rem]">
          Every launch. Every pool. Every hour. <span className="text-gray-500">AI watching Robinhood Chain, 24/7.</span>
        </p>
        <div className="flex items-center gap-1.5 text-xs text-gray-500 pill bg-white/[0.03] px-3 py-1.5 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 breathe" /> Live
        </div>
      </div>

      {/* Obi intro strip — a short, light "who's talking" moment before
          the verdict, so first-time visitors get Obi's identity before
          his opinion. The video itself moved to a fixed background element
          (see .obi-bg-video below) since it looked too small/cramped as a
          little inline thumbnail here. */}
      <div className="card obi-strip p-3.5 mb-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-300">
            <span className="text-[#b7a3ff] font-medium">Obi</span> is Observo&apos;s AI — it watches every pool and launch on Robinhood Chain, 24/7.
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
            {OBI_CHECKLIST.map((item) => (
              <span key={item} className="flex items-center gap-1 text-[11px] text-gray-500">
                <span className="text-[#8b6bff]">✓</span> {item}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <Link href="/about#a-what" className="text-xs text-[#b7a3ff] font-medium hover:text-[#8b6bff] whitespace-nowrap hidden sm:inline">
            Read more →
          </Link>
          <a
            href="https://www.ponsfamily.com/launchpad/0xc08827D1b2194ddcE1BF4d21C5b7ac42bE20A5CD"
            target="_blank"
            rel="noopener noreferrer"
            className="obi-buy-btn-live pill px-3 py-1.5 text-xs font-medium whitespace-nowrap"
          >
            Buy $OBI
          </a>
        </div>
      </div>

      {/* Obi's verdict card — the "what Obi thinks right now" moment,
          separate from the intro strip above. */}
      <div className="card verdict-glow p-5 mb-6">
        <div className="mono text-[11px] text-[#8b6bff] tracking-wide uppercase mb-1.5 flex items-center gap-2">
          <span className="breathe">✦</span> Obi&apos;s read on right now
        </div>
        <p className="font-display verdict-headline mb-3" dangerouslySetInnerHTML={{ __html: verdictHeadline().html }} />

        <div className="flex items-center gap-2.5 mb-4">
          <span className="text-[11px] text-gray-500 mono whitespace-nowrap">Confidence</span>
          <div className="confidence-bar">
            <div className="confidence-fill" style={{ width: `${confidencePct}%` }} />
          </div>
          <span className="text-[11px] text-gray-500 mono whitespace-nowrap">{currentCell?.confidence ?? "—"}</span>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap text-[11px] text-gray-500 mono">
          {scannedStat && <span>{scannedStat}</span>}
          {sourceCount > 0 && <span>· {sourceCount} source{sourceCount === 1 ? "" : "s"} cross-referenced</span>}
          {currentCell?.signed_at && <span>· signed {new Date(currentCell.signed_at).toLocaleTimeString()}</span>}
        </div>
      </div>

      <Ticker />

      <div className="heatmap-breakout">
      <div className="heatmap-breakout-inner">

      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <button
          onClick={() => setTab("volume")}
          className={`pill px-4 py-2 text-sm font-medium ${tab === "volume" ? "tab-active" : "text-gray-400 bg-white/[0.03]"}`}
        >
          Volume
        </button>
        <button
          onClick={() => setTab("launch")}
          className={`pill px-4 py-2 text-sm font-medium ${tab === "launch" ? "tab-active" : "text-gray-400 bg-white/[0.03]"}`}
        >
          New Launches
        </button>
        <div className="ml-auto flex items-center gap-1.5 text-sm">
          <button
            onClick={() => setMode("trader")}
            className={`mode-btn pill px-3.5 py-1.5 text-xs font-semibold ${mode === "trader" ? "mode-trader-active" : "text-gray-400"}`}
          >
            Best time to trade
          </button>
          <button
            onClick={() => setMode("deployer")}
            className={`mode-btn pill px-3.5 py-1.5 text-xs font-semibold ${mode === "deployer" ? "mode-deployer-active" : "text-gray-400"}`}
          >
            Best time to launch
          </button>
        </div>
      </div>

      <div className="card heatmap-hero p-5 sm:p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-display font-semibold text-base">{tab === "volume" ? "Best hours to trade" : "Best hours to launch"}</div>
            <div className="text-xs text-gray-500 mt-0.5">Hover or tap any hour for Obi&apos;s note</div>
          </div>
          <div className="text-xs text-gray-500">{DAYS[nowDay]} · now {shortHourLabel(nowHour)}</div>
        </div>

        <div className="scan-wrap">
          <div className="scan-line" />
          <div className="text-xs text-gray-500 mb-2">This week</div>
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="min-w-[560px]">
              {DAYS.map((day, dayIdx) => (
                <div key={day} className="flex items-center gap-1 mb-1">
                  <div className="w-8 text-[10px] text-gray-500 mono">{day}</div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cell = byKey.get(cellKey(dayIdx, h));
                    return (
                      <div
                        key={h}
                        className={`cell flex-1 h-6 ${cell && cell.score >= 8 ? "cell-hot" : ""}`}
                        style={{
                          background: cell ? scoreColor(cell.score) : "#1A1A1A",
                          outline: dayIdx === nowDay && h === nowHour ? "2px solid #FBBF24" : undefined,
                        }}
                        onClick={() => openCell(cell)}
                        onMouseEnter={(e) => onCellEnter(e, dayIdx, h, cell)}
                        onMouseMove={onCellMove}
                        onMouseLeave={onCellLeave}
                        onTouchStart={(e) => onCellTouch(e, dayIdx, h, cell)}
                      />
                    );
                  })}
                </div>
              ))}
              <div className="flex gap-1 mt-1 pl-9">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="flex-1 text-center text-[8.5px] text-gray-600 mono">
                    {h % 3 === 0 ? shortHourLabel(h) : ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-800 text-[11px] text-gray-500 flex-wrap">
          <span>Quiet</span>
          <div className="flex gap-0.5">
            <span className="w-3.5 h-2 rounded-sm inline-block" style={{ background: "#141d16" }} />
            <span className="w-3.5 h-2 rounded-sm inline-block" style={{ background: "#1c3a24" }} />
            <span className="w-3.5 h-2 rounded-sm inline-block" style={{ background: "#256b38" }} />
            <span className="w-3.5 h-2 rounded-sm inline-block" style={{ background: "#3ecb63" }} />
          </div>
          <span>Peak</span>
          <div className="flex items-center gap-1 ml-1"><span className="w-2.5 h-2.5 rounded-full inline-block border-2 border-amber-400" /> Now</div>
        </div>
        {loading && <div className="text-xs text-gray-500 mt-3">Loading...</div>}
      </div>

      </div>
      </div>

      {selected && (
        <div className="card p-5 mb-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="font-display font-semibold">{hourLabel(selected.hour_of_day)} · {DAYS[selected.day_of_week]}</div>
            <div className={`pill px-3 py-1 text-xs font-medium ${tagFor(selected.score).cls}`}>{tagFor(selected.score).text}</div>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">{selected.reasoning}</p>
          <div className={`grid gap-2 mt-4 ${formatStat(selected, tab) ? "grid-cols-3" : "grid-cols-2"}`}>
            {formatStat(selected, tab) && (
              <div className="bg-[#1C1C1C] rounded-xl p-2.5 text-center">
                <div className="text-[10px] text-gray-500">{tab === "volume" ? "Volume" : "Launches"}</div>
                <div className="font-semibold text-sm mt-0.5 mono">{formatStat(selected, tab)}</div>
              </div>
            )}
            <div className="bg-[#1C1C1C] rounded-xl p-2.5 text-center">
              <div className="text-[10px] text-gray-500">Confidence</div>
              <div className="font-semibold text-sm mt-0.5 capitalize">{selected.confidence}</div>
            </div>
            <div className="bg-[#1C1C1C] rounded-xl p-2.5 text-center">
              <div className="text-[10px] text-gray-500">Score</div>
              <div className="font-semibold text-sm mt-0.5">{selected.score}/10</div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-800">
            <button onClick={toggleWhy} className="verify-trigger flex items-center gap-1.5 text-[11px] text-[#8b6bff] font-medium">
              <span>✦</span> Why this window? &amp; verify signature
              <span className="text-gray-600">·</span>
              <span className="text-gray-500">{whyOpen ? "hide" : "expand"}</span>
            </button>
            <div className={`verify-panel ${whyOpen ? "open" : ""}`}>
              <div className="bg-[#1C1C1C] rounded-xl p-3.5 mt-3 text-[11px]">
                {verifyState === "checking" && (
                  <div className="flex items-center gap-2 text-gray-400">
                    <span className="verify-spinner" /> Verifying signature...
                  </div>
                )}
                {(verifyState === "valid" || verifyState === "invalid") && (
                  <div className="space-y-2">
                    <div className={`flex items-center gap-1.5 font-medium ${verifyState === "valid" ? "text-emerald-400" : "text-red-500"}`}>
                      <span className="verify-check">{verifyState === "valid" ? "✓" : "✕"}</span>
                      {verifyState === "valid" ? "Signature valid — this verdict is untampered" : "Signature could not be verified"}
                    </div>
                    <div className="mono text-gray-500 break-all">
                      <div className="mb-1"><span className="text-gray-600">hash</span> {selected.payload_hash}</div>
                      <div><span className="text-gray-600">sig</span> {selected.signature}</div>
                    </div>
                    <Link href="/about#a-verify" className="inline-block text-gray-500 underline">how this works</Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <Link href="/api-docs" className="card p-5 flex items-center justify-between gap-3 flex-wrap mb-4 hover:border-gray-600 transition-colors">
        <div>
          <div className="text-sm font-semibold font-display">Building a bot?</div>
          <div className="text-xs text-gray-500 mt-0.5">Observo has an API with the same AI verdicts, ready for agents.</div>
        </div>
        <code className="text-[11px] mono bg-[#1C1C1C] border border-gray-700 rounded-lg px-3 py-2 text-gray-400">/api/v1/heatmap</code>
      </Link>

      <HeatmapTooltip state={tooltip.state} />
    </div>
  );
}
