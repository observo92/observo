"use client";

import DocsToc from "@/components/DocsToc";

const TOC = [
  { id: "p-collect", label: "What we collect" },
  { id: "p-not", label: "What we don't do" },
  { id: "p-third", label: "Third-party services" },
  { id: "p-q", label: "Questions" },
];

export default function PrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto px-5 py-10 flex-1 w-full">
      <div className="docs-shell">
        <DocsToc items={TOC} />

        <main className="min-w-0">
          <div className="mono text-[11px] tracking-wide uppercase text-[#3ecb63] font-semibold mb-2">Privacy Policy · Updated July 2026</div>
          <h1 className="text-2xl font-bold font-display mb-2">We read the chain, not you.</h1>
          <p className="text-gray-500 mb-8">
            Observo only reads public, on-chain data. No wallet connection, no account, no sign-in
            required to use the heatmap.
          </p>

          <div className="callout mb-8">
            <span className="k">The short version</span>
            <p className="text-[14.5px] text-gray-300">
              There&apos;s very little personal data to collect in the first place — the heatmap
              works without connecting a wallet or creating an account.
            </p>
          </div>

          <h2 id="p-collect" className="font-semibold font-display text-lg mt-11 mb-3 scroll-mt-24">What we collect</h2>
          <ul className="clist">
            <li>
              <div className="ic yes">✓</div>
              <div>
                <b className="text-sm">On-chain data</b>{" "}
                <span className="text-[13.5px] text-gray-500">— publicly available deployment events, trading volume, and pool data from Robinhood Chain. This isn&apos;t personal data; it&apos;s public blockchain activity.</span>
              </div>
            </li>
            <li>
              <div className="ic yes">✓</div>
              <div>
                <b className="text-sm">Basic usage analytics</b>{" "}
                <span className="text-[13.5px] text-gray-500">— anonymized page views and API request counts, used only to understand what&apos;s being used and to prevent abuse.</span>
              </div>
            </li>
            <li>
              <div className="ic yes">✓</div>
              <div>
                <b className="text-sm">API keys</b>{" "}
                <span className="text-[13.5px] text-gray-500">(if you register for higher rate limits) — an email address, used only to issue and manage your key.</span>
              </div>
            </li>
          </ul>

          <h2 id="p-not" className="font-semibold font-display text-lg mt-11 mb-3 scroll-mt-24">What we don&apos;t do</h2>
          <ul className="clist">
            <li>
              <div className="ic no">✕</div>
              <span className="text-[13.5px] text-gray-500">We don&apos;t require wallet connection to view the heatmap.</span>
            </li>
            <li>
              <div className="ic no">✕</div>
              <span className="text-[13.5px] text-gray-500">We don&apos;t sell personal data to third parties.</span>
            </li>
            <li>
              <div className="ic no">✕</div>
              <span className="text-[13.5px] text-gray-500">We don&apos;t track you across other websites.</span>
            </li>
          </ul>

          <h2 id="p-third" className="font-semibold font-display text-lg mt-11 mb-3 scroll-mt-24">Third-party services</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Observo relies on public blockchain infrastructure (Blockscout, RPC providers) and
            AI inference providers to generate verdicts. These providers process the on-chain data
            described above, not personal information about you.
          </p>

          <h2 id="p-q" className="font-semibold font-display text-lg mt-11 mb-3 scroll-mt-24">Questions</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            This is an early-stage, indie-built product. If you have questions about this policy,
            reach out through the contact listed on our official channels.
          </p>
        </main>
      </div>
    </div>
  );
}
