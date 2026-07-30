"use client";

import { useEffect, useState } from "react";

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  sub: string;
}

// Shared tooltip for heatmap cells. Desktop: shows on hover, follows the
// mouse. Touch devices: no native hover, so cells call `show()` on tap
// instead (see page.tsx) and it's positioned near the tapped cell and
// dismissed on next tap/outside click — this is what keeps the "hover
// tooltip" behavior actually usable on mobile instead of just silently
// not working.
export function useHeatmapTooltip() {
  const [state, setState] = useState<TooltipState>({ visible: false, x: 0, y: 0, title: "", sub: "" });

  useEffect(() => {
    if (!state.visible) return;
    function onAway() {
      setState((s) => ({ ...s, visible: false }));
    }
    window.addEventListener("scroll", onAway, true);
    return () => window.removeEventListener("scroll", onAway, true);
  }, [state.visible]);

  function show(x: number, y: number, title: string, sub: string) {
    setState({ visible: true, x, y, title, sub });
  }
  function move(x: number, y: number) {
    setState((s) => (s.visible ? { ...s, x, y } : s));
  }
  function hide() {
    setState((s) => ({ ...s, visible: false }));
  }

  return { state, show, move, hide };
}

export function HeatmapTooltip({ state }: { state: TooltipState }) {
  return (
    <div
      className={`hm-tooltip ${state.visible ? "visible" : ""}`}
      style={{ left: state.x + 14, top: state.y + 14 }}
    >
      <div className="t-title">{state.title}</div>
      <div className="t-sub">{state.sub}</div>
    </div>
  );
}
