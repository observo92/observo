// bow.fun's own bulk API — used as a cross-check/enrichment source
// alongside raw Blockscout logs (adds deployer launch history, graduation
// status, market cap progress that Blockscout events alone don't include).

const BASE = process.env.BOWFUN_API_URL || "https://bow.fun/api/tokens";

export interface BowfunToken {
  token: string;
  name: string;
  sym: string;
  mc: number;
  progress: number;
  graduated: boolean;
  migrated: boolean;
  vol24: number;
  created: number | null; // unix seconds
  deployer: string;
  devLaunches: number; // total tokens this deployer has launched on bow.fun
}

interface BowfunResponse {
  tokens: BowfunToken[];
  page: number;
  pages: number;
  total: number;
  perPage: number;
}

async function fetchPage(page: number): Promise<BowfunResponse> {
  const res = await fetch(`${BASE}?page=${page}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`bow.fun API HTTP ${res.status} (page ${page})`);
  return res.json();
}

// Fetches up to `maxPages` pages (25 tokens/page) of bow.fun's most recent
// tokens. Used to enrich Blockscout-decoded deployments with deployer
// launch-history context for the "deployer mode" reputation signal.
export async function fetchRecentBowfunTokens(maxPages = 20): Promise<BowfunToken[]> {
  const first = await fetchPage(1);
  const results = [...first.tokens];
  const pagesToFetch = Math.min(maxPages, first.pages);

  for (let page = 2; page <= pagesToFetch; page++) {
    const next = await fetchPage(page);
    results.push(...next.tokens);
  }
  return results;
}

// Builds a lookup of deployer address -> total launch count, from a batch
// of bow.fun tokens already fetched. Cheap, since devLaunches is already
// per-token in the API response (no extra calls needed).
export function buildDeployerLaunchCounts(tokens: BowfunToken[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tokens) {
    map.set(t.deployer.toLowerCase(), t.devLaunches);
  }
  return map;
}
