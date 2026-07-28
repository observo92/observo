"use client";

import { useEffect, useRef } from "react";

// Roaming mascot: wanders to random points behind page content, pausing
// between moves. Ported as-is from the approved mockup behavior — only the
// sprite asset + this wiring is user-approved, do not redesign the bot itself.
export default function ObservoBot() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bot = ref.current;
    if (!bot) return;

    let x = Math.random() * (window.innerWidth - 32);
    let y = Math.random() * (window.innerHeight - 64);
    let facing = 1;
    let pauseUntil = 0;
    let raf = 0;

    function pickTarget() {
      const margin = 20;
      const tx = margin + Math.random() * (window.innerWidth - margin * 2 - 32);
      const ty = margin + Math.random() * (window.innerHeight - margin * 2 - 64);
      return { tx, ty };
    }

    let target = pickTarget();

    function step(ts: number) {
      if (!bot) return;
      if (ts < pauseUntil) {
        raf = requestAnimationFrame(step);
        return;
      }
      const dx = target.tx - x;
      const dy = target.ty - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 4) {
        bot.classList.remove("walking");
        pauseUntil = ts + 1200 + Math.random() * 2000;
        target = pickTarget();
        raf = requestAnimationFrame(step);
        return;
      }

      bot.classList.add("walking");
      const speed = 0.9;
      facing = dx < 0 ? -1 : 1;
      x += (dx / dist) * speed;
      y += (dy / dist) * speed;

      bot.style.transform = `translate(${x}px, ${y}px) scaleX(${facing})`;
      raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);

    function onResize() {
      x = Math.min(x, window.innerWidth - 32);
      y = Math.min(y, window.innerHeight - 64);
    }
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <div ref={ref} className="observo-bot" />;
}
