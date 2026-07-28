"use client";

// Static intro card for Obi (Observo's mascot), separate from the
// roaming ObservoBot sprite. Shows a waving pose + a disabled "Buy $OBI"
// button with a "soon" tooltip — token isn't live yet.
export default function ObiIntro() {
  return (
    <div className="card p-5 mb-4 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-4">
        <div className="obi-wave-wrap shrink-0">
          <div className="obi-sprite" />
          <span className="obi-hand">👋</span>
        </div>
        <div>
          <div className="font-semibold text-sm">Meet Obi</div>
          <div className="text-xs text-gray-500 mt-0.5 max-w-xs">
            Obi is Observo&apos;s mascot, wandering the site keeping an eye on the data.
          </div>
        </div>
      </div>

      <div className="obi-buy-wrap">
        <button disabled className="obi-buy-btn pill px-4 py-2 text-sm font-medium">
          Buy $OBI
        </button>
        <span className="obi-tooltip">soon</span>
      </div>
    </div>
  );
}
