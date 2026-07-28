// Robinhood Chain launchpad contract configs. Addresses and topic0 hashes
// are public on-chain facts (verified directly via Blockscout getLogs
// against each contract), not proprietary to any other project.

import { decodeAbiParameters } from "../abi-decode";
import type { BlockscoutLog } from "./blockscout";

export type LaunchpadId = "flap" | "pons" | "bow";

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
function decodeFlap(log: BlockscoutLog): DecodedDeployment {
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
    deployedAt: new Date(parseInt(log.timeStamp, 16) * 1000),
  };
}

// Pons: TokenDeployed(address indexed token, address indexed deployer, ...)
function decodePons(log: BlockscoutLog): DecodedDeployment {
  return {
    launchpad: "pons",
    tokenAddress: "0x" + log.topics[1]!.slice(-40),
    deployerAddress: "0x" + log.topics[2]!.slice(-40),
    blockNumber: parseInt(log.blockNumber, 16),
    txHash: log.transactionHash,
    deployedAt: new Date(parseInt(log.timeStamp, 16) * 1000),
  };
}

// bow.fun: Launched(address indexed token, address indexed deployer, ...)
function decodeBow(log: BlockscoutLog): DecodedDeployment {
  return {
    launchpad: "bow",
    tokenAddress: "0x" + log.topics[1]!.slice(-40),
    deployerAddress: "0x" + log.topics[2]!.slice(-40),
    blockNumber: parseInt(log.blockNumber, 16),
    txHash: log.transactionHash,
    deployedAt: new Date(parseInt(log.timeStamp, 16) * 1000),
  };
}

const DECODERS: Record<LaunchpadId, (log: BlockscoutLog) => DecodedDeployment> = {
  flap: decodeFlap,
  pons: decodePons,
  bow: decodeBow,
};

export function decodeDeploymentLog(launchpad: LaunchpadId, log: BlockscoutLog): DecodedDeployment {
  return DECODERS[launchpad](log);
}
