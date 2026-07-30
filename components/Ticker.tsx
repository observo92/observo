"use client";

import { useEffect, useState } from "react";

interface TickerItem {
  label: string;
  value: string;
  direction: "up" | "down" | "flat";
}

// Live stats marquee — real aggregates from /api/v1/ticker (backed by
// raw_snapshots), not placeholder/fake numbers. Duplicated once so the
// CSS scroll animation (translateX -50%) loops seamlessly.
export default function Ticker() {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/ticker")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;

  const doubled = [...items, ...items];

  return (
    <div className="ticker-wrap mb-4">
      <div className="ticker-track">
        {doubled.map((item, i) => (
          <div key={i} className="ticker-item">
            {item.label} <b className={item.direction === "up" ? "up" : item.direction === "down" ? "down" : ""}>{item.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
