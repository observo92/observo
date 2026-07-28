// GeckoTerminal client for Robinhood Chain pool data. Called directly by
// Observo (not via any third party's API) — this is the "volume heatmap"
// data source. Network id is "robinhood"; not listed on GeckoTerminal's
// public /networks page 1 but confirmed working via direct pool queries.

const BASE = process.env.GECKOTERMINAL_BASE_URL || "https://api.geckoterminal.com/api/v2";
const NETWORK = "robinhood";

interface GtPool {
  id: string;
  attributes: {
    address: string;
    name: string;
    volume_usd: { h24: string };
  };
  relationships: {
    dex: { data: { id: string } };
    base_token: { data: { id: string } };
    quote_token: { data: { id: string } };
  };
}

interface GtPoolsResponse {
  data: GtPool[];
}

// GeckoTerminal's free tier rate-limits aggressively (~30 req/min) — a
// naive loop over 100 pools hits 429s constantly. Retry with backoff on
// 429/5xx rather than silently dropping data (this was a real bug found
// during backfill testing: 429s caused 0 rows to be written at all).
async function gtFetch<T>(path: string): Promise<T> {
  let res: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // hard cap — fetch can hang indefinitely otherwise
    try {
      res = await fetch(`${BASE}${path}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      lastError = undefined;
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      lastError = e;
      res = undefined;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (!res || !res.ok) {
    throw new Error(`GeckoTerminal ${path} -> HTTP ${res?.status ?? "no response"} ${lastError ? `(${(lastError as Error).message})` : ""}`);
  }
  return res.json();
}

// Small fixed delay between calls to stay under the free-tier rate limit
// in the first place, instead of relying purely on retry-after-the-fact.
function throttle(ms = 600) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface PoolSummary {
  poolAddress: string;
  poolName: string;
  dexId: string;
  volume24hUsd: number;
}

// Top pools by volume on Robinhood Chain, across multiple pages (each page
// is 20 pools). Used to know which pools/dexes exist before pulling their
// hourly OHLCV history.
export async function fetchTopPools(pages = 5): Promise<PoolSummary[]> {
  const results: PoolSummary[] = [];
  for (let page = 1; page <= pages; page++) {
    const json = await gtFetch<GtPoolsResponse>(
      `/networks/${NETWORK}/pools?page=${page}`
    );
    if (!json.data || json.data.length === 0) break;
    for (const pool of json.data) {
      results.push({
        poolAddress: pool.attributes.address,
        poolName: pool.attributes.name,
        dexId: pool.relationships.dex.data.id,
        volume24hUsd: parseFloat(pool.attributes.volume_usd.h24 || "0"),
      });
    }
    if (page < pages) await throttle();
  }
  return results;
}

export interface HourlyVolumePoint {
  timestampSec: number;
  volumeUsd: number;
}

// Hourly OHLCV candles for a single pool. GeckoTerminal returns
// [timestamp, open, high, low, close, volume] tuples, most recent first.
// `beforeTimestamp` paginates further back in time for backfill.
export async function fetchHourlyVolume(
  poolAddress: string,
  limit = 24,
  beforeTimestamp?: number
): Promise<HourlyVolumePoint[]> {
  const params = new URLSearchParams({ limit: String(Math.min(limit, 1000)) });
  if (beforeTimestamp) params.set("before_timestamp", String(beforeTimestamp));
  const json = await gtFetch<{
    data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } };
  }>(`/networks/${NETWORK}/pools/${poolAddress}/ohlcv/hour?${params.toString()}`);
  await throttle();

  const list = json.data?.attributes?.ohlcv_list || [];
  return list.map(([ts, , , , , volume]) => ({ timestampSec: ts, volumeUsd: volume }));
}
