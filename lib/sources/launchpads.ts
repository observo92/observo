// Robinhood Chain launchpad contract configs. Addresses and topic0 hashes
// are public on-chain facts (verified directly via Blockscout getLogs
// against each contract), not proprietary to any other project.

import { decodeAbiParameters } from "../abi-decode";

// Generic log shape covering both Blockscout's legacy getLogs format and
// the chain RPC's eth_getLogs format -- both give topics/data/blockNumber
// as hex, just under slightly different field names for the tx hash. Event
// timestamp is NOT part of this (RPC logs report blockTimestamp as 0x0 on
// this chain -- it must be looked up separately per block and passed in).
export interface GenericLog {
  topics: (string | null)[];
  data: string;
  blockNumber: string; // hex
  transactionHash: string;
}

export type LaunchpadId = "flap" | "pons" | "bow" | "pools";

export interface LaunchpadConfig {
  id: LaunchpadId;
  contractAddress: string;
  topic0: string;
  chunkBlocks: number;
}

export const LAUNCHPADS: LaunchpadConfig[] = [
  {
    id: "flap",
    contractAddress: "0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09",
    topic0: "0x504e7f360b2e5fe33cbaaae4c593bc55305328341bf79009e43e0e3b7f699603",
    chunkBlocks: 20000,
  },
  {
    id: "pons",
    contractAddress: "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB",
    topic0: "0x1461370115e1c2be79cb529f8cfcbd11316e789d9c6099fc83417b0b4c48c62a",
    chunkBlocks: 20000,
  },
  {
    id: "bow",
    contractAddress: "0xc70e510e14710ea535cab7b2414860af63feab79",
    topic0: "0xec774f0683e9ac48e8d835f412f9f877a8a5dee9af3170d78cf3ef33149d15e7",
    chunkBlocks: 20000,
  },
  {
    // pools.trade -- a launchpad built by Uniswap on Robinhood Chain
    // (backend at entry-gateway.backend-prod.api.uniswap.org). Tokens are
    // deployed via the UERC20Factory contract's TokenCreated event, then
    // paired into either an "Instant Launch" bonding curve or a "Crowd
    // Launch" (CCA/auction) pre-launch window before reaching a Uniswap
    // V3 pool. Verified via Blockscout: UERC20Factory contract, source
    // confirmed as verified Solidity (src/factories/UERC20Factory.sol).
    id: "pools",
    contractAddress: "0x000000e200088D55C39a11F609E5F667729ad49b",
    topic0: "0x4ef8284ecf42d4cd19686572ffd87f630858c82398911e776cb831de35eddbf4",
    chunkBlocks: 20000,
  },
];

export interface DecodedDeployment {
  launchpad: LaunchpadId;
  tokenAddress: string;
  deployerAddress: string | null;
  blockNumber: number;
  txHash: string;
  deployedAt: Date;
}

// flap.sh: TokenCreated(uint256 ts, address creator, uint256 nonce,
// address token, string name, string symbol, string meta) — all non-indexed.
function decodeFlap(log: GenericLog, timestampSec: number): DecodedDeployment {
  const [, creator, , token] = decodeAbiParameters(
    ["uint256", "address", "uint256", "address", "string", "string", "string"],
    log.data
  );
  return {
    launchpad: "flap",
    tokenAddress: token as string,
    deployerAddress: creator as string,
    blockNumber: parseInt(log.blockNumber, 16),
    txHash: log.transactionHash,
    deployedAt: new Date(timestampSec * 1000),
  };
}

// Pons: TokenDeployed(address indexed token, address indexed deployer, ...)
function decodePons(log: GenericLog, timestampSec: number): DecodedDeployment {
  return {
    launchpad: "pons",
    tokenAddress: "0x" + log.topics[1]!.slice(-40),
    deployerAddress: "0x" + log.topics[2]!.slice(-40),
    blockNumber: parseInt(log.blockNumber, 16),
    txHash: log.transactionHash,
    deployedAt: new Date(timestampSec * 1000),
  };
}

// bow.fun: Launched(address indexed token, address indexed deployer, ...)
function decodeBow(log: GenericLog, timestampSec: number): DecodedDeployment {
  return {
    launchpad: "bow",
    tokenAddress: "0x" + log.topics[1]!.slice(-40),
    deployerAddress: "0x" + log.topics[2]!.slice(-40),
    blockNumber: parseInt(log.blockNumber, 16),
    txHash: log.transactionHash,
    deployedAt: new Date(timestampSec * 1000),
  };
}

// pools.trade: UERC20Factory.TokenCreated(address tokenAddress, (string
// description, string social, string image, bytes extra) metadata) --
// non-indexed, no deployer in the event itself (deployer is msg.sender in
// the tx, not emitted). deployerAddress is left null here rather than
// spending an extra eth_getTransactionByHash call per log to recover it,
// since no downstream code currently reads deployerAddress for any
// launchpad -- only deployedAt (for hourly bucketing) is used.
function decodePools(log: GenericLog, timestampSec: number): DecodedDeployment {
  const [token] = decodeAbiParameters(["address"], log.data.slice(0, 66));
  return {
    launchpad: "pools",
    tokenAddress: token as string,
    deployerAddress: null,
    blockNumber: parseInt(log.blockNumber, 16),
    txHash: log.transactionHash,
    deployedAt: new Date(timestampSec * 1000),
  };
}

const DECODERS: Record<LaunchpadId, (log: GenericLog, timestampSec: number) => DecodedDeployment> = {
  flap: decodeFlap,
  pons: decodePons,
  bow: decodeBow,
  pools: decodePools,
};

export function decodeDeploymentLog(launchpad: LaunchpadId, log: GenericLog, timestampSec: number): DecodedDeployment {
  return DECODERS[launchpad](log, timestampSec);
}
