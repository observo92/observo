export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-10 flex-1 w-full">
      <h1 className="text-2xl font-bold mb-2">About Observo</h1>
      <p className="text-gray-500 mb-8">Timing, made obvious — with an AI that shows its work.</p>

      <div className="card p-6 mb-5">
        <h2 className="font-semibold mb-2">What Observo does</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Observo watches activity across Robinhood Chain — trading volume and new token launches on
          Pons, flap.sh, and bow.fun — and turns it into two simple heatmaps: when volume tends to be
          strong, and when it&apos;s a good time to launch a new token. An AI reviews the data before every
          verdict, not just a raw average.
        </p>
      </div>

      <div className="card p-6 mb-5">
        <h2 className="font-semibold mb-2">What the AI actually does, step by step</h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-4">
          A plain average can be misleading — a &quot;busy hour&quot; might just be a couple of bots trading
          back and forth. So instead of turning numbers straight into a sentence, Observo&apos;s AI goes
          through a small investigation every hour, for every heatmap, before it says anything:
        </p>
        <div className="space-y-3">
          {[
            ["Look at what happened this hour", "Pulls this hour's volume, deploys, and wallet activity."],
            ["Check if it's real activity", "Is the volume spread across many wallets, or just 2–3 of them going back and forth? That pattern usually means bots, not real interest."],
            ["Compare it against everything else", "Is this hour busy chain-wide, or just on one launchpad? Are wallets with a good track record active right now, or is it new/unknown wallets?"],
            ["Only then, write the verdict", "The score and explanation you see are the result of steps 1–3 — not a guess made straight from raw numbers."],
          ].map(([title, desc], i) => (
            <div key={title} className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-500 shrink-0">
                {i + 1}
              </div>
              <div>
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-sm text-gray-600 leading-relaxed mt-4">
          This runs fresh every hour, for both heatmaps — so the reasoning you read is never more
          than an hour old.
        </p>
      </div>

      <div id="verify" className="card p-6 mb-5">
        <h2 className="font-semibold mb-2">How we verify it</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Every verdict Observo publishes is cryptographically signed the moment it&apos;s created. That
          means the reasoning and score you see can&apos;t be quietly changed after the fact — if even one
          character changed, the signature would no longer match. Anyone can independently check a
          verdict&apos;s signature against Observo&apos;s public key.
        </p>
      </div>

      <div className="card p-6 mb-5">
        <h2 className="font-semibold mb-2">Two ways to read the heatmap</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          The same hour can mean different things depending on what you&apos;re doing. High volume is
          great if you&apos;re trading, but a lot of tokens launching at once can bury your own launch in
          the noise. That&apos;s why Observo has two modes — 🎯 Trader and 🚀 Deployer — instead of one
          generic score.
        </p>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold mb-2">Independent, not affiliated</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Observo is not affiliated with Robinhood, Pons, flap.sh, or bow.fun. We simply observe
          public on-chain activity. Nothing here is financial advice — Observo describes patterns in
          historical and current data; it does not guarantee future outcomes.
        </p>
      </div>
    </div>
  );
}
