export default function ApiDocsPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-10 flex-1 w-full">
      <h1 className="text-2xl font-bold mb-2">API</h1>
      <p className="text-gray-500 mb-8">Same AI verdicts Observo shows you, built for bots and agents. Free, no wallet connection required.</p>

      <div className="card p-6 mb-5">
        <h2 className="font-semibold mb-3">Get the heatmap grid</h2>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 mono text-[12.5px] text-gray-600 mb-3 overflow-x-auto">
          GET https://observo.xyz/api/v1/heatmap?feature=volume&amp;mode=trader
        </div>
        <div className="bg-[#1C1C1C] rounded-xl p-4 mono text-[12px] text-gray-300 overflow-x-auto leading-relaxed">
<pre>{`{
  "feature": "volume",
  "mode": "trader",
  "grid": [
    {
      "day_of_week": 2,
      "hour_of_day": 15,
      "score": 6,
      "confidence": "low",
      "reasoning": "This hour is the 4th busiest of the day, but the data is based on only a few days of history, so it's not very reliable yet.",
      "payload_hash": "861db2938b2116cbbaa03b8ebea439490a4e57d09a20f4c72b5f7e9d149fcb79",
      "signature": "xH4is/bB/wqB4yQbKXanT22XIHyTujERhXntHYB89Qy8TfkdvNES1HOKLXrg3ZE7G0N2+Z7flqO4KLHZdEbwAQ==",
      "signed_at": "2026-07-22T13:37:11Z"
    }
  ],
  "publicKey": "MCowBQYDK2VwAyEA..."
}`}</pre>
        </div>
      </div>

      <div className="card p-6 mb-5">
        <h2 className="font-semibold mb-3">Parameters</h2>
        <table className="w-full text-sm text-gray-600">
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-2 mono text-xs">feature</td>
              <td className="py-2 text-gray-400">&quot;volume&quot; or &quot;launch&quot;</td>
            </tr>
            <tr>
              <td className="py-2 mono text-xs">mode</td>
              <td className="py-2 text-gray-400">&quot;trader&quot; or &quot;deployer&quot;</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card p-6 mb-5">
        <h2 className="font-semibold mb-3">Verify a signature</h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-3">
          Every verdict is signed the moment it&apos;s generated with Ed25519. Verify independently
          without trusting Observo&apos;s servers — or just POST to our verify endpoint:
        </p>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 mono text-[12.5px] text-gray-600 mb-3 overflow-x-auto">
          POST https://observo.xyz/api/v1/verify {`{ "hash": "...", "signature": "..." }`}
        </div>
        <div className="bg-[#1C1C1C] rounded-xl p-4 mono text-[12px] text-gray-300 overflow-x-auto leading-relaxed">
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

      <div className="card p-6">
        <h2 className="font-semibold mb-3">Rate limits</h2>
        <table className="w-full text-sm text-gray-600">
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-2">Anonymous</td>
              <td className="py-2 text-right text-gray-400">60 requests / hour</td>
            </tr>
            <tr>
              <td className="py-2">With free API key</td>
              <td className="py-2 text-right text-gray-400">600 requests / hour</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
