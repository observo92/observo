"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Heatmap" },
  { href: "/api-docs", label: "API" },
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-gray-800 bg-black/70 backdrop-blur sticky top-0 z-30">
      <div className="max-w-4xl mx-auto px-5 py-3.5 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-500 to-amber-500 flex items-center justify-center text-black font-bold text-sm">
            O
          </div>
          <div>
            <div className="font-bold font-display text-[15px] leading-none">Observo</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Powered by AI</div>
          </div>
        </Link>
        <nav className="hidden sm:flex items-center gap-5">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`navlink ${pathname === link.href ? "active" : ""}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <button className="sm:hidden text-gray-500" onClick={() => setOpen((o) => !o)}>
          ☰
        </button>
      </div>
      {open && (
        <nav className="sm:hidden flex flex-col gap-3 px-5 pb-4">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`navlink ${pathname === link.href ? "active" : ""}`}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
