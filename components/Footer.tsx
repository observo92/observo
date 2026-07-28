import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-gray-100 mt-auto">
      <div className="max-w-4xl mx-auto px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-[11px] text-gray-400">Observo · Powered by AI · Robinhood Chain</div>
        <div className="flex items-center gap-4 text-[11px] text-gray-400">
          <Link href="/about" className="hover:text-gray-700">About</Link>
          <Link href="/api-docs" className="hover:text-gray-700">API</Link>
          <Link href="/privacy" className="hover:text-gray-700">Privacy</Link>
          <Link href="/terms" className="hover:text-gray-700">Terms</Link>
        </div>
      </div>
    </footer>
  );
}
