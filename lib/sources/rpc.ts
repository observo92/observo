// Direct JSON-RPC client for Robinhood Chain (chainId 4663), used as the
// launch-scanning data source instead of Blockscout's HTTP APIs.
//
// Why this exists: Blockscout's legacy `getLogs` endpoint (the original
// source for launch data) got rate-limited to zero (`x-ratelimit-limit: 0`)
// on 2026-08-01, killing launch data collection for ~40 hours straight.
// Blockscout's newer v2 API (`/api/v2/addresses/{addr}/logs`) doesn't have
// that same block, but it can't filter by topic0 or block range server-side
// — it only returns the most recent N events across ALL of a contract's
// event types, paginated 50 at a time. For chatty contracts (flap, pons
// emit many non-launch events per launch event), covering even a single
// hour required 3-9+ pages at ~300ms-4s each, well past the ~45s budget
// available in the hourly cron.
//
// The chain's own RPC endpoint (from the official chain registry,
// chainlist.org / chainid.network, entry for chainId 4663) supports
// eth_getLogs with real server-side topic0 + block-range filtering, same
// as any standard EVM chain. Verified empirically: querying a ~2-2.8 hour
// block range for the busiest launch contract took ~300-350ms, vs 14+
// seconds and still incomplete via Blockscout v2 for the same window.
const RPC_URL = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json: JsonRpcResponse<T> = await res.json();
  if (json.error) throw new Error(`RPC ${method} error: ${json.error.message}`);
  if (json.result === undefined) throw new Error(`RPC ${method}: no result in response`);
  return json.result;
}

export interface RpcLog {
  address: string;
  topics: (string | null)[];
  data: string;
  blockNumber: string; // hex
  transactionHash: string;
  transactionIndex: string; // hex
  logIndex: string; // hex
}

export async function fetchLatestBlockNumberRpc(): Promise<number> {
  const hex = await rpcCall<string>("eth_blockNumber", []);
  return parseInt(hex, 16);
}

// Real server-side topic0 + block-range filtering, unlike Blockscout's v2
// address-logs endpoint. No manual pagination/splitting needed for the
// block ranges this app uses (hourly cron: ~2-2.8h windows; verified fine
// up to 100k blocks / ~2.8h in one call) — kept simple rather than
// preemptively adding the same recursive-split complexity that
// blockscout.ts needed for the legacy HTTP API's row-count truncation.
export async function fetchLogsRpc(
  address: string,
  topic0: string,
  fromBlock: number,
  toBlock: number
): Promise<RpcLog[]> {
  return rpcCall<RpcLog[]>("eth_getLogs", [
    {
      address,
      topics: [topic0],
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + toBlock.toString(16),
    },
  ]);
}

// Block-timestamp ESTIMATION via linear interpolation between two real
// on-chain anchor points, instead of looking up every individual block.
//
// Why: eth_getLogs results don't include a usable blockTimestamp (observed
// as always 0x0 on this chain), so timestamps must come from somewhere
// else. The obvious approach -- batch eth_getBlockByNumber calls for every
// unique block a matching log appears in -- was tried and found to hit a
// burst rate limit on this RPC: batches of 100 work individually, but only
// ~3 back-to-back full-size batches succeed before 429s start, and recovery
// takes ~30s. Chatty launch contracts (flap, pons) can have 500+ unique
// blocks in one ~2.5h scan window, requiring 6+ batches -- well past that
// burst limit, and the ~30s recovery wait alone would blow the cron's ~45s
// budget.
//
// Instead: fetch just 2 real block timestamps (the range's start and end
// block) and derive every other block's timestamp via linear
// interpolation. This works because Robinhood Chain (an L2 with a fixed
// sequencer interval) has extremely consistent block times -- verified
// empirically across a ~2.5h / ~90,000 block range: interpolated estimates
// were never off by more than ~2.2 seconds from the real on-chain
// timestamp. That's far more precision than this needs, since logs are
// only ever bucketed into hour-wide buckets.
export class BlockTimeEstimator {
  private constructor(
    private readonly anchorBlock: number,
    private readonly anchorTimestampSec: number,
    private readonly secondsPerBlock: number
  ) {}

  static async create(fromBlock: number, toBlock: number): Promise<BlockTimeEstimator> {
    const [fromTs, toTs] = await Promise.all([
      rpcCall<{ timestamp: string }>("eth_getBlockByNumber", ["0x" + fromBlock.toString(16), false]).then(
        (b) => parseInt(b.timestamp, 16)
      ),
      rpcCall<{ timestamp: string }>("eth_getBlockByNumber", ["0x" + toBlock.toString(16), false]).then(
        (b) => parseInt(b.timestamp, 16)
      ),
    ]);
    const secondsPerBlock = toBlock > fromBlock ? (toTs - fromTs) / (toBlock - fromBlock) : 0.101;
    return new BlockTimeEstimator(fromBlock, fromTs, secondsPerBlock);
  }

  estimateTimestampSec(blockNumber: number): number {
    return Math.round(this.anchorTimestampSec + (blockNumber - this.anchorBlock) * this.secondsPerBlock);
  }
}
