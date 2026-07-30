"use client";

import { useEffect, useState } from "react";

interface TocItem {
  id: string;
  label: string;
}

// Sticky sidebar table-of-contents with scroll-spy (dot lights up on the
// section currently in view). Collapses into a horizontal pill scroller
// on mobile via CSS (see .docs-toc media query in globals.css).
export default function DocsToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          setActive(visible[0].target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );

    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav className="docs-toc">
      <div className="eyebrow">On this page</div>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={`toc-link ${active === item.id ? "active" : ""}`}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          <span className="dot" />
          {item.label}
        </a>
      ))}
    </nav>
  );
}
