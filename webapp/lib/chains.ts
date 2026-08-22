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
