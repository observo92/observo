"use client";

// Intro card for Obi (Observo's mascot), separate from the roaming
// ObservoBot sprite. Shows a looping video clip (public/obi-video.mp4,
// user-supplied, 720x1280/9:16), a short lore blurb, and a disabled
// "Buy $OBI" button with a "soon" tooltip — token isn't live yet.
//
// Previously used a static idle-bounce sprite (obi-front.png) before a
// multi-angle turnaround animation attempt was rejected for inconsistent
// AI-generated frames — now replaced with the real video clip.
export default function ObiIntro() {
  return (
    <div className="card p-5 mb-4 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-4">
        <div className="obi-video-wrap shrink-0">
          <video
            className="obi-video"
            src="/obi-video.mp4"
            autoPlay
            loop
            muted
            playsInline
          />
        </div>
        <div>
          <div className="font-semibold text-sm">Meet Obi</div>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed max-w-sm">
            Obi lives inside Observo, wandering the site around the clock so nothing on Robinhood
            Chain slips by unnoticed. Every heatmap cell you see has already been checked by Obi
            first — pools scanned, launches counted, patterns cross-referenced — before the AI
            writes a single word of its verdict. Obi doesn&apos;t sleep, doesn&apos;t guess, and
            never gets tired of watching the charts so you don&apos;t have to.
          </p>
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
