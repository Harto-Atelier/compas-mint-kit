import type { ChainOption } from "./mint-types";

export const CHAINS: ChainOption[] = [
  {
    key: "ethereum",
    chainId: 1,
    name: "Ethereum",
    explorer: "https://etherscan.io",
    nativeSymbol: "ETH",
  },
  {
    key: "base",
    chainId: 8453,
    name: "Base",
    explorer: "https://basescan.org",
    nativeSymbol: "ETH",
  },
  {
    key: "robinhood",
    chainId: 4663,
    name: "Robinhood Chain",
    explorer: "https://robinhoodchain.blockscout.com",
    nativeSymbol: "ETH",
  },
];

export const GUIDED_DEFAULT_CHAINS: ChainOption[] = CHAINS.filter((chain) => chain.key === "ethereum" || chain.key === "base");

export type GuidedChainGate = {
  admin?: boolean;
  lowLatencyBroadcast?: boolean;
  multiRpc?: boolean;
  robinhoodSequencer?: boolean;
};

export function guidedMintChainOptions(gate: GuidedChainGate = {}): ChainOption[] {
  const robinhoodAllowed = Boolean(
    gate.admin &&
    gate.lowLatencyBroadcast &&
    gate.multiRpc &&
    gate.robinhoodSequencer,
  );
  return robinhoodAllowed ? CHAINS : GUIDED_DEFAULT_CHAINS;
}

const CHAIN_ALIASES: Record<string, string> = {
  eth: "ethereum",
  ethereum: "ethereum",
  mainnet: "ethereum",
  base: "base",
  robinhood: "robinhood",
};

export function resolveChain(key?: string | null): ChainOption {
  const normalized = (key || "base").trim().toLowerCase();
  const aliased = CHAIN_ALIASES[normalized] ?? normalized;
  return CHAINS.find((chain) => chain.key === aliased) ?? CHAINS[1];
}

export function normalizeChainKey(segment: string): string {
  const normalized = segment.trim().toLowerCase();
  return CHAIN_ALIASES[normalized] ?? normalized;
}
