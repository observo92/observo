export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-10 flex-1 w-full">
      <h1 className="text-2xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-gray-500 mb-8 text-sm">Last updated: July 2026</p>

      <div className="card p-6 mb-5">
        <h2 className="font-semibold mb-2">The short version</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Observo only reads public, on-chain data. We don&apos;t ask you to connect a wallet, sign a
          message, or create an account to use the heatmap. There&apos;s very little personal data to
          collect in the first place.
        </p>
      </div>

      <div className="card p-6 mb-5">
        <h2 className="font-semibold mb-2">What we collect</h2>
        <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
          <li><b>On-chain data</b> — publicly available deployment events, trading volume, and pool
            data from Robinhood Chain. This isn&apos;t personal data; it&apos;s public blockchain activity.</li>
          <li><b>Basic usage analytics</b> — anonymized page views and API request counts, used only
            to understand what&apos;s being used and to prevent abuse.</li>
          <li><b>API keys</b> (if you register for higher rate limits) — an email address, used only
            to issue and manage your key.</li>
        </ul>
      </div>

      <div className="card p-6 mb-5">
        <h2 className="font-semibold mb-2">What we don&apos;t do</h2>
        <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
          <li>We don&apos;t require wallet connection to view the heatmap.</li>
          <li>We don&apos;t sell personal data to third parties.</li>
          <li>We don&apos;t track you across other websites.</li>
        </ul>
      </div>

      <div className="card p-6 mb-5">
        <h2 className="font-semibold mb-2">Third-party services</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          Observo relies on public blockchain infrastructure (Blockscout, RPC providers) and
          AI inference providers to generate verdicts. These providers process the on-chain data
          described above, not personal information about you.
        </p>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold mb-2">Questions</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          This is an early-stage, indie-built product. If you have questions about this policy,
          reach out through the contact listed on our official channels.
        </p>
      </div>
    </div>
  );
}
