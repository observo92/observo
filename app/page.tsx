"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { VerdictCell } from "@/lib/types";
import ObiIntro from "@/components/ObiIntro";

type Feature = "volume" | "launch";
type Mode = "trader" | "deployer";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function scoreColor(score: number): string {
  if (score <= 3) return "#1C2B1F";
  if (score <= 6) return "#3F8F52";
  return "#3ECB63";
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

export default function Home() {
  const [tab, setTab] = useState<Feature>("volume");
  const [mode, setMode] = useState<Mode>("trader");
  const [grid, setGrid] = useState<VerdictCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<VerdictCell | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<"idle" | "checking" | "valid" | "invalid">("idle");

  const now = useMemo(() => new Date(), []);
  const nowDay = now.getUTCDay();
  const nowHour = now.getUTCHours();

  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/heatmap?feature=${tab}&mode=${mode}`)
      .then((r) => r.json())
      .then((data) => {
        setGrid(data.grid ?? []);
        setSelected(null);
        setVerifyOpen(false);
      })
      .finally(() => setLoading(false));
  }, [tab, mode]);

  const byKey = useMemo(() => {
    const map = new Map<string, VerdictCell>();
    for (const cell of grid) map.set(cellKey(cell.day_of_week, cell.hour_of_day), cell);
    return map;
  }, [grid]);

  const currentCell = byKey.get(cellKey(nowDay, nowHour));

  function openCell(cell: VerdictCell | undefined) {
    if (!cell) return;
    setSelected(cell);
    setVerifyOpen(false);
    setVerifyState("idle");
  }

  async function toggleVerify() {
    if (!selected) return;
    const next = !verifyOpen;
    setVerifyOpen(next);
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

  function aiSaysText(): { html: string } {
    const score = currentCell?.score ?? 0;
    if (!currentCell) {
      return { html: `Still gathering data for this hour — check back soon.` };
    }
    if (tab === "volume") {
      if (score >= 7) return { html: `Right now looks <b class="text-emerald-400">pretty good</b> for buying — ${currentCell.reasoning}` };
      if (score >= 4) return { html: `Right now is <b class="text-gray-400">fairly average</b> — ${currentCell.reasoning}` };
      return { html: `Right now looks <b class="text-amber-400">a bit quiet</b> — ${currentCell.reasoning}` };
    } else {
      if (score >= 7) return { html: `Right now looks <b class="text-emerald-400">good for launching</b> — ${currentCell.reasoning}` };
      if (score >= 4) return { html: `Right now is <b class="text-gray-400">a normal window</b> — ${currentCell.reasoning}` };
      return { html: `Right now is <b class="text-amber-400">pretty crowded</b> — ${currentCell.reasoning}` };
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-5 py-6 flex-1 w-full">
      <div className="flex items-center justify-end mb-4">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 pill border border-gray-700 px-3 py-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 breathe" /> Live
        </div>
      </div>

      <div className="card p-5 mb-4">
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
          <span className="breathe">✨</span> Observo AI says
        </div>
        <p className="text-[15px] leading-relaxed" dangerouslySetInnerHTML={{ __html: aiSaysText().html }} />
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setTab("volume")}
          className={`pill px-4 py-2 text-sm font-medium ${tab === "volume" ? "tab-active" : "text-gray-400 border border-gray-700"}`}
        >
          Volume
        </button>
        <button
          onClick={() => setTab("launch")}
          className={`pill px-4 py-2 text-sm font-medium ${tab === "launch" ? "tab-active" : "text-gray-400 border border-gray-700"}`}
        >
          New Launches
        </button>
        <div className="ml-auto flex items-center gap-1.5 text-sm">
          <button
            onClick={() => setMode("trader")}
            className={`pill px-3 py-1.5 border text-xs font-medium ${mode === "trader" ? "mode-trader-active" : "border-gray-700 text-gray-400"}`}
          >
            I want to trade
          </button>
          <button
            onClick={() => setMode("deployer")}
            className={`pill px-3 py-1.5 border text-xs font-medium ${mode === "deployer" ? "mode-deployer-active" : "border-gray-700 text-gray-400"}`}
          >
            I want to launch
          </button>
        </div>
      </div>

      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold text-sm">{tab === "volume" ? "Best hours to trade" : "Best hours to launch"}</div>
            <div className="text-xs text-gray-500 mt-0.5">Tap any hour to see why</div>
          </div>
          <div className="text-xs text-gray-500">Today, {DAYS[nowDay]}</div>
        </div>

        <div className="scan-wrap">
          <div className="scan-line" />
          <div className="flex gap-1 mb-1">
            {Array.from({ length: 24 }, (_, h) => {
              const cell = byKey.get(cellKey(nowDay, h));
              return (
                <div
                  key={h}
                  className="cell flex-1 h-9"
                  style={{
                    background: cell ? scoreColor(cell.score) : "#1A1A1A",
                    outline: h === nowHour ? "2px solid #FBBF24" : undefined,
                  }}
                  onClick={() => openCell(cell)}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[9px] text-gray-600 mb-4 px-0.5">
            <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
          </div>

          <div className="text-xs text-gray-500 mb-2">This week</div>
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="min-w-[520px]">
              {DAYS.map((day, dayIdx) => (
                <div key={day} className="flex items-center gap-1 mb-1">
                  <div className="w-8 text-[10px] text-gray-500">{day}</div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cell = byKey.get(cellKey(dayIdx, h));
                    return (
                      <div
                        key={h}
                        className="cell flex-1 h-4"
                        style={{
                          background: cell ? scoreColor(cell.score) : "#1A1A1A",
                          outline: dayIdx === nowDay && h === nowHour ? "2px solid #FBBF24" : undefined,
                        }}
                        onClick={() => openCell(cell)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-800 text-[11px] text-gray-500 flex-wrap">
          <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "#1C2B1F" }} /> Quiet</div>
          <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "#3F8F52" }} /> Active</div>
          <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "#3ECB63" }} /> Hot</div>
          <div className="flex items-center gap-1 ml-1"><span className="w-2.5 h-2.5 rounded-full inline-block border-2 border-amber-400" /> Now</div>
        </div>
        {loading && <div className="text-xs text-gray-500 mt-3">Loading...</div>}
      </div>

      {selected && (
        <div className="card p-5 mb-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="font-semibold">{hourLabel(selected.hour_of_day)} · {DAYS[selected.day_of_week]}</div>
            <div className={`pill px-3 py-1 text-xs font-medium ${tagFor(selected.score).cls}`}>{tagFor(selected.score).text}</div>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">{selected.reasoning}</p>
          <div className="grid grid-cols-2 gap-2 mt-4">
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
            <button onClick={toggleVerify} className="verify-trigger flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
              <span>✓</span> Checked &amp; signed by Observo AI
              <span className="text-gray-600">·</span>
              <span className="text-gray-500">
                {verifyState === "idle" && "tap to verify"}
                {verifyState === "checking" && "verifying..."}
                {verifyState === "valid" && "verified"}
                {verifyState === "invalid" && "invalid"}
              </span>
            </button>
            <div className={`verify-panel ${verifyOpen ? "open" : ""}`}>
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
                    <Link href="/about#verify" className="inline-block text-gray-500 underline">how this works</Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <ObiIntro />

      <Link href="/api-docs" className="card p-5 flex items-center justify-between gap-3 flex-wrap mb-4 hover:border-gray-600 transition-colors">
        <div>
          <div className="text-sm font-semibold">Building a bot?</div>
          <div className="text-xs text-gray-500 mt-0.5">Observo has an API with the same AI verdicts, ready for agents.</div>
        </div>
        <code className="text-[11px] mono bg-[#1C1C1C] border border-gray-700 rounded-lg px-3 py-2 text-gray-400">/api/v1/heatmap</code>
      </Link>
    </div>
  );
}
