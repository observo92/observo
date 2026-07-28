// Blockscout client for Robinhood Chain — direct on-chain event scanning
// for token launch/deploy events. No API key required.

const LEGACY_API_BASE = `${process.env.BLOCKSCOUT_BASE_URL || "https://robinhoodchain.blockscout.com"}/api`;
const V2_API_BASE = process.env.BLOCKSCOUT_BASE_URL || "https://robinhoodchain.blockscout.com";

export interface BlockscoutLog {
  address: string;
  blockNumber: string; // hex
  data: string;
  logIndex: string;
  timeStamp: string; // hex, unix seconds
  topics: (string | null)[];
  transactionHash: string;
  transactionIndex: string;
}

interface GetLogsResponse {
  status: string;
  message: string;
  result: BlockscoutLog[] | string;
}

// The legacy getLogs endpoint silently truncates at 1000 rows per call with
// no error indicator. Any range returning exactly 1000 rows is treated as
// "possibly truncated" and recursively split until each half is under the cap.
const TRUNCATION_CAP = 1000;

async function fetchLogsRaw(
  address: string,
  topic0: string,
  fromBlock: number,
  toBlock: number
): Promise<BlockscoutLog[]> {
  const url = new URL(LEGACY_API_BASE);
  url.searchParams.set("module", "logs");
  url.searchParams.set("action", "getLogs");
  url.searchParams.set("address", address);
  url.searchParams.set("topic0", topic0);
  url.searchParams.set("fromBlock", String(fromBlock));
  url.searchParams.set("toBlock", String(toBlock));

  // Retries on 429 (rate limit) AND 5xx — large block ranges can trigger a
  // server-side timeout (500) on Blockscout's end, not just rate limiting.
  // Found via real backfill testing: a 6M-block single call 500'd outright.
  let res: Response | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      res = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: controller.signal });
    } catch {
      res = undefined;
    } finally {
      clearTimeout(timeout);
    }
    if (res && res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }

  if (!res || !res.ok) {
    throw new Error(`Blockscout getLogs HTTP ${res?.status ?? "no response"} for ${address} [${fromBlock}-${toBlock}]`);
  }

  const json: GetLogsResponse = await res.json();
  if (json.status === "0") {
    if (json.message === "No logs found") return [];
    throw new Error(`Blockscout getLogs error [${fromBlock}-${toBlock}]: ${json.message}`);
  }
  return Array.isArray(json.result) ? json.result : [];
}

// Proactive chunk size — ranges wider than this are split BEFORE querying,
// not just reactively after hitting the 1000-row truncation cap. Very wide
// single-shot ranges (millions of blocks) were found to 500 server-side
// during real backfill testing, independent of row count.
const MAX_RANGE_BLOCKS = 50_000;

export async function fetchLogs(
  address: string,
  topic0: string,
  fromBlock: number,
  toBlock: number
): Promise<BlockscoutLog[]> {
  if (fromBlock > toBlock) return [];

  if (toBlock - fromBlock > MAX_RANGE_BLOCKS) {
    const mid = Math.floor((fromBlock + toBlock) / 2);
    const [left, right] = await Promise.all([
      fetchLogs(address, topic0, fromBlock, mid),
      fetchLogs(address, topic0, mid + 1, toBlock),
    ]);
    return [...left, ...right];
  }

  let logs: BlockscoutLog[];
  try {
    logs = await fetchLogsRaw(address, topic0, fromBlock, toBlock);
  } catch (e) {
    // Even within MAX_RANGE_BLOCKS, a chunk can still fail (dense range,
    // transient server issue) — split and retry rather than failing the
    // entire backfill over one bad chunk.
    const mid = Math.floor((fromBlock + toBlock) / 2);
    if (mid <= fromBlock) throw e;
    const [left, right] = await Promise.all([
      fetchLogs(address, topic0, fromBlock, mid),
      fetchLogs(address, topic0, mid + 1, toBlock),
    ]);
    return [...left, ...right];
  }

  if (logs.length < TRUNCATION_CAP) return logs;

  const mid = Math.floor((fromBlock + toBlock) / 2);
  if (mid <= fromBlock) return logs;

  const [left, right] = await Promise.all([
    fetchLogs(address, topic0, fromBlock, mid),
    fetchLogs(address, topic0, mid + 1, toBlock),
  ]);
  return [...left, ...right];
}

// Current chain height, used to know where backfill/incremental scans should stop.
export async function fetchLatestBlockNumber(): Promise<number> {
  const res = await fetch(`${V2_API_BASE}/api/v2/blocks?type=block`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Blockscout blocks HTTP ${res.status}`);
  const json = await res.json();
  return json.items[0].height as number;
}

// Approximates the block number at a given unix timestamp using average
// block time on Robinhood Chain (~0.101s/block, verified empirically).
// Good enough for backfill windowing; exact boundaries don't matter since
// events are grouped into hour buckets by their own on-chain timestamp anyway.
const AVG_BLOCK_TIME_SEC = 0.101;

export async function estimateBlockAtTimestamp(targetTimestampSec: number): Promise<number> {
  const latestBlock = await fetchLatestBlockNumber();
  const nowSec = Math.floor(Date.now() / 1000);
  const secondsAgo = nowSec - targetTimestampSec;
  const blocksAgo = Math.round(secondsAgo / AVG_BLOCK_TIME_SEC);
  return Math.max(0, latestBlock - blocksAgo);
}
