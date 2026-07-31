"use client";

import DocsToc from "@/components/DocsToc";

const TOC = [
  { id: "api-heatmap", label: "Get the heatmap grid" },
  { id: "api-verify", label: "Verify a signature" },
  { id: "api-limits", label: "Rate limits" },
];

export default function ApiDocsPage() {
  return (
    <div className="max-w-4xl mx-auto px-5 py-10 flex-1 w-full">
      <div className="docs-shell">
        <DocsToc items={TOC} />

        <main className="min-w-0">
          <div className="mono text-[11px] tracking-wide uppercase text-[#3ecb63] font-semibold mb-2">API Reference</div>
          <h1 className="text-2xl font-bold font-display mb-2">Same AI verdicts, built for bots.</h1>
          <p className="text-gray-500 mb-8">Free, no wallet connection required.</p>

          <h2 id="api-heatmap" className="font-semibold font-display text-lg mt-11 mb-3 scroll-mt-24">Get the heatmap grid</h2>
          <div className="endpoint-card">
            <div className="endpoint-head">
              <span className="method get">GET</span>
              <span className="endpoint-path">/api/v1/heatmap?feature=volume&amp;mode=trader</span>
            </div>
            <div className="endpoint-body">
              <div className="bg-[#0D1017] rounded-xl p-4 mono text-[12px] text-gray-300 overflow-x-auto leading-relaxed">
<pre>{`{
  "feature": "volume",
  "mode": "trader",
  "grid": [
    {
      "day_of_week": 2,
      "hour_of_day": 15,
      "score": 6,
      "confidence": "low",
      "reasoning": "This hour is the 4th busiest of the day, but the historical data backing it is still limited, so it's not very reliable yet.",
      "payload_hash": "861db2938b2116cbbaa03b8ebea439490a4e57d09a20f4c72b5f7e9d149fcb79",
      "signature": "xH4is/bB/wqB4yQbKXanT22XIHyTujERhXntHYB89Qy8TfkdvNES1HOKLXrg3ZE7G0N2+Z7flqO4KLHZdEbwAQ==",
      "signed_at": "2026-07-22T13:37:11Z"
    }
  ],
  "publicKey": "MCowBQYDK2VwAyEA..."
}`}</pre>
              </div>

              <table className="w-full text-sm text-gray-400 mt-4">
                <thead>
                  <tr>
                    <th className="text-left pb-2 text-[11px] uppercase tracking-wide text-gray-600 border-b border-gray-800 font-medium">Param</th>
                    <th className="text-left pb-2 text-[11px] uppercase tracking-wide text-gray-600 border-b border-gray-800 font-medium">Values</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-800">
                    <td className="py-2.5 mono text-xs text-[#3ecb63]">feature</td>
                    <td className="py-2.5 text-gray-500">&quot;volume&quot; or &quot;launch&quot;</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 mono text-xs text-[#3ecb63]">mode</td>
                    <td className="py-2.5 text-gray-500">&quot;trader&quot; or &quot;deployer&quot;</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <h2 id="api-verify" className="font-semibold font-display text-lg mt-11 mb-3 scroll-mt-24">Verify a signature</h2>
          <p className="text-sm text-gray-400 leading-relaxed mb-3">
            Every verdict is signed the moment it&apos;s generated with Ed25519. Verify independently
            without trusting Observo&apos;s servers — or just POST to our verify endpoint:
          </p>
          <div className="endpoint-card">
            <div className="endpoint-head">
              <span className="method post">POST</span>
              <span className="endpoint-path">/api/v1/verify</span>
            </div>
            <div className="endpoint-body">
              <div className="bg-[#0D1017] rounded-xl p-4 mono text-[12px] text-gray-300 overflow-x-auto leading-relaxed">
<pre>{`import { verify } from "crypto";

const isValid = verify(
  null,
  Buffer.from(hash, "hex"),
  publicKeyObject,       // imported from the SPKI DER public key above
  Buffer.from(signature, "base64")
);
// true = untampered, genuinely signed by Observo`}</pre>
              </div>
            </div>
          </div>

          <h2 id="api-limits" className="font-semibold font-display text-lg mt-11 mb-3 scroll-mt-24">Rate limits</h2>
          <div>
            <span className="rate-pill">
              Anonymous <b>60/hr</b>
              <span className="bar"><i style={{ width: "20%" }} /></span>
            </span>
            <span className="rate-pill">
              With free API key <b>600/hr</b>
              <span className="bar"><i style={{ width: "80%" }} /></span>
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}
