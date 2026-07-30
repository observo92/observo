"use client";

import DocsToc from "@/components/DocsToc";

const TOC = [
  { id: "a-what", label: "What Observo does" },
  { id: "a-how", label: "Step-by-step AI process" },
  { id: "a-verify", label: "How we verify it" },
  { id: "a-modes", label: "Two heatmap modes" },
  { id: "a-indep", label: "Independent, not affiliated" },
];

// Heat-scale timeline: node color runs quiet(dark)->peak(bright green),
// matching the heatmap's own scoreColor gradient — step 1 is a raw,
// unconfirmed signal; step 4 is the AI's finished, confident verdict.
const STEPS: Array<{ title: string; desc: string; node: string; tag?: { text: string; bg: string; color: string } }> = [
  {
    title: "Look at what happened this hour",
    desc: "Pulls this hour's volume, deploys, and wallet activity.",
    node: "#1c3a24",
    tag: { text: "raw signal", bg: "rgba(28,58,36,0.4)", color: "#6FBF8A" },
  },
  {
    title: "Check if it's real activity",
    desc: "Is the volume spread across many wallets, or just 2–3 of them going back and forth? That pattern usually means bots, not real interest.",
    node: "#256b38",
  },
  {
    title: "Compare it against everything else",
    desc: "Is this hour busy chain-wide, or just on one launchpad? Are wallets with a good track record active right now, or is it new/unknown wallets?",
    node: "#2fa350",
  },
  {
    title: "Only then, write the verdict",
    desc: "The score and explanation you see are the result of steps 1–3 — not a guess made straight from raw numbers.",
    node: "#3ecb63",
    tag: { text: "confidence set", bg: "rgba(62,203,99,0.15)", color: "#3ecb63" },
  },
];

export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto px-5 py-10 flex-1 w-full">
      <div className="docs-shell">
        <DocsToc items={TOC} />

        <main className="min-w-0">
          <div className="mono text-[11px] tracking-wide uppercase text-[#3ecb63] font-semibold mb-2">About Observo</div>
          <h1 className="text-2xl font-bold font-display mb-2">Timing, made obvious — with an AI that shows its work.</h1>
          <p className="text-gray-500 mb-8">
            Observo watches Robinhood Chain and turns raw activity into two heatmaps: when volume is
            strong, and when it&apos;s a good time to launch.
          </p>

          <h2 id="a-what" className="font-semibold font-display text-lg mt-11 mb-3 scroll-mt-24">What Observo does</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Observo watches activity across Robinhood Chain — trading volume and new token launches on
            Pons, flap.sh, and bow.fun — and turns it into two simple heatmaps: when volume tends to be
            strong, and when it&apos;s a good time to launch a new token. An AI reviews the data before every
            verdict, not just a raw average.
          </p>

          <h2 id="a-how" className="font-semibold font-display text-lg mt-11 mb-3 scroll-mt-24">What the AI actually does, step by step</h2>
          <p className="text-sm text-gray-400 leading-relaxed mb-6">
            A plain average can be misleading — a &quot;busy hour&quot; might just be a couple of bots trading
            back and forth. So instead of turning numbers straight into a sentence, Observo&apos;s AI goes
            through a small investigation every hour, for every heatmap, before it says anything:
          </p>

          <div className="mb-2">
            {STEPS.map((step, i) => (
              <div key={step.title} className="tstep">
                <div className="tline" />
                <div className="node" style={{ background: step.node }}>{i + 1}</div>
                <div>
                  <h3 className="text-sm font-medium">
                    {step.title}
                    {step.tag && (
                      <span className="heat-tag" style={{ background: step.tag.bg, color: step.tag.color }}>
                        {step.tag.text}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="callout mt-6">
            <span className="k">Refreshed hourly</span>
            <p className="text-[14.5px] text-gray-300">
              This runs fresh every hour, for both heatmaps — so the reasoning you read is never more
              than an hour old.
            </p>
          </div>

          <h2 id="a-verify" className="font-semibold font-display text-lg mt-11 mb-3 scroll-mt-24">How we verify it</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            Every verdict Observo publishes is cryptographically signed the moment it&apos;s created. That
            means the reasoning and score you see can&apos;t be quietly changed after the fact — if even one
            character changed, the signature would no longer match. Anyone can independently check a
            verdict&apos;s signature against Observo&apos;s public key.
          </p>

          <h2 id="a-modes" className="font-semibold font-display text-lg mt-11 mb-3 scroll-mt-24">Two ways to read the heatmap</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            The same hour can mean different things depending on what you&apos;re doing. High volume is
            great if you&apos;re trading, but a lot of tokens launching at once can bury your own launch in
            the noise. That&apos;s why Observo has two modes — Trader and Deployer — instead of one
            generic score.
          </p>

          <h2 id="a-indep" className="font-semibold font-display text-lg mt-11 mb-3 scroll-mt-24">Independent, not affiliated</h2>
          <div className="callout">
            <span className="k">Not financial advice</span>
            <p className="text-[14.5px] text-gray-300">
              Observo is not affiliated with Robinhood, Pons, flap.sh, or bow.fun. We simply observe
              public on-chain activity. Nothing here is financial advice — Observo describes patterns in
              historical and current data; it does not guarantee future outcomes.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
