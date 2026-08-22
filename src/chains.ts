import fs from "fs";

// Chain registry — everything chain-specific lives here so adding a new
// network is a single entry instead of hunting for hardcoded values.
//
// `key` is the identifier used in three places, and they must match:
//   1. the OpenSea GraphQL `chain` field (opensea-api.ts)
//   2. the `--chain` CLI option
//   3. the `CHAIN` env var
//
// Robinhood Chain network parameters are published by Robinhood at
// docs.robinhood.com/chain/add-network-to-wallet and the public RPC currently
// returns eth_chainId 0x1237 (4663). Its OpenSea/SeaDrop singleton deployment is
// not assumed: configure SEADROP_ADDRESS_ROBINHOOD or CHAIN_REGISTRY_JSON before
// building executable SeaDrop calldata for that chain.

export interface ChainProfile {
  key: string;          // OpenSea id + --chain value + CHAIN env value
  chainId: number;      // EVM network chain id
  name: string;         // human label
  explorer: string;     // block explorer base URL, NO trailing slash
  nativeSymbol: string;
  seadropAddress?: string; // per-chain SeaDrop singleton, when verified/configured
  requiresSeaDropConfig?: boolean;
  rpc: {
    alchemyHost?: string; // Alchemy host for this network (docs/reference)
    public: string[];     // public RPC + sequencer endpoints
  };
}

type EnvLike = Record<string, string | undefined>;

export const OPENSEA_SEADROP_ADDRESS = "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5";

const BUILTIN_CHAINS: ChainProfile[] = [
  {
    key: "ethereum",
    chainId: 1,
    name: "Ethereum",
    explorer: "https://etherscan.io",
    nativeSymbol: "ETH",
    seadropAddress: OPENSEA_SEADROP_ADDRESS,
    rpc: {
      alchemyHost: "eth-mainnet.g.alchemy.com",
      public: [
        "https://ethereum-rpc.publicnode.com",
        "https://eth.merkle.io",
        "https://cloudflare-eth.com",
      ],
    },
  },
  {
    key: "base",
    chainId: 8453,
    name: "Base",
    explorer: "https://basescan.org",
    nativeSymbol: "ETH",
    seadropAddress: OPENSEA_SEADROP_ADDRESS,
    rpc: {
      alchemyHost: "base-mainnet.g.alchemy.com",
      public: [
        "https://mainnet.base.org",
        "https://base-rpc.publicnode.com",
        // Send-only (rejects eth_chainId/eth_call) but the fastest inclusion
        // path — planRpcs keeps it for blasting and never reads from it.
        "https://mainnet-sequencer.base.org",
      ],
    },
  },
  {
    key: "robinhood",
    chainId: 4663,
    name: "Robinhood Chain",
    explorer: "https://robinhoodchain.blockscout.com",
    nativeSymbol: "ETH",
    requiresSeaDropConfig: true,
    rpc: {
      public: [
        "https://rpc.mainnet.chain.robinhood.com/",
      ],
    },
  },
];

// Backward-compatible built-in registry. Use getChains()/resolveChain() when env
// overrides or custom JSON chains should be visible.
export const CHAINS: ChainProfile[] = BUILTIN_CHAINS;

const DEFAULT_EXPLORER = "https://basescan.org";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const CHAIN_ALIASES: Record<string, string> = {
  eth: "ethereum",
  ethereum: "ethereum",
  mainnet: "ethereum",
  base: "base",
  robinhood: "robinhood",
};

export function getChains(env: EnvLike = process.env): ChainProfile[] {
  const merged = new Map<string, ChainProfile>();
  for (const chain of BUILTIN_CHAINS) merged.set(chain.key, cloneChain(chain));
  for (const chain of chainsFromJsonConfig(env)) merged.set(chain.key, chain);

  return [...merged.values()].map((chain) => applyEnvOverrides(chain, env));
}

// Resolve a chain by its numeric chainId (from the live network) or by its
// string key (--chain / CHAIN). Returns undefined for unknown chains.
export function resolveChain(
  idOrKey: string | number | bigint | null | undefined,
  env: EnvLike = process.env
): ChainProfile | undefined {
  if (idOrKey === null || idOrKey === undefined) return undefined;
  const chains = getChains(env);
  if (typeof idOrKey === "string") {
    const normalized = normalizeChainKey(idOrKey);
    const byKey = chains.find((c) => c.key === normalized);
    if (byKey) return byKey;
    if (/^\d+$/.test(normalized)) {
      const id = Number(normalized);
      return chains.find((c) => c.chainId === id);
    }
    return undefined;
  }
  const id = Number(idOrKey);
  return chains.find((c) => c.chainId === id);
}

export function resolveSeaDropAddress(
  idOrKey: string | number | bigint | null | undefined,
  env: EnvLike = process.env
): string | undefined {
  return resolveChain(idOrKey, env)?.seadropAddress;
}

export function normalizeChainKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  return CHAIN_ALIASES[normalized] ?? normalized;
}

// Build a block-explorer tx URL for whatever chain we're on. Accepts either the
// numeric chainId (preferred — it's authoritative) or the chain key. Falls back
// to Basescan for unknown chains so links are never broken silently.
export function explorerTx(
  idOrKey: string | number | bigint | null | undefined,
  txHash: string
): string {
  const profile = resolveChain(idOrKey);
  const base = profile?.explorer ?? DEFAULT_EXPLORER;
  return `${base}/tx/${txHash}`;
}

function applyEnvOverrides(chain: ChainProfile, env: EnvLike): ChainProfile {
  const suffix = chain.key.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const seadropAddress = cleanAddress(env[`SEADROP_ADDRESS_${suffix}`] ?? env[`SEADROP_${suffix}`]) ?? chain.seadropAddress;
  const rpc = splitList(env[`RPC_URL_${suffix}`]);
  const explorer = cleanUrl(env[`CHAIN_EXPLORER_${suffix}`]) ?? chain.explorer;
  const nativeSymbol = (env[`CHAIN_NATIVE_SYMBOL_${suffix}`] || chain.nativeSymbol).trim();

  return {
    ...chain,
    explorer,
    nativeSymbol,
    seadropAddress,
    requiresSeaDropConfig: chain.requiresSeaDropConfig && !seadropAddress,
    rpc: {
      ...chain.rpc,
      public: rpc.length > 0 ? rpc : chain.rpc.public,
    },
  };
}

function chainsFromJsonConfig(env: EnvLike): ChainProfile[] {
  const inline = env.CHAIN_REGISTRY_JSON || env.CHAINS_JSON;
  const fromPath = readRegistryPath(env.CHAIN_REGISTRY_PATH || env.CHAIN_REGISTRY_FILE);
  const payloads = [inline, fromPath].filter((value): value is string => Boolean(value && value.trim()));
  return payloads.flatMap((payload) => {
    try {
      const parsed = JSON.parse(payload) as unknown;
      const entries = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.chains)
          ? parsed.chains
          : [];
      return entries.map(parseChainProfile).filter((chain): chain is ChainProfile => Boolean(chain));
    } catch {
      return [];
    }
  });
}

function parseChainProfile(value: unknown): ChainProfile | null {
  if (!isRecord(value)) return null;
  const key = typeof value.key === "string" ? normalizeChainKey(value.key) : "";
  const chainId = toPositiveInteger(value.chainId);
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : key;
  const explorer = cleanUrl(typeof value.explorer === "string" ? value.explorer : undefined);
  const nativeSymbol = typeof value.nativeSymbol === "string" && value.nativeSymbol.trim()
    ? value.nativeSymbol.trim()
    : undefined;
  const seadropAddress = cleanAddress(typeof value.seadropAddress === "string" ? value.seadropAddress : undefined);
  const rpcUrls = [
    ...splitList(typeof value.rpcUrl === "string" ? value.rpcUrl : undefined),
    ...splitList(typeof value.rpcUrls === "string" ? value.rpcUrls : undefined),
    ...(Array.isArray(value.rpcUrls) ? value.rpcUrls.filter((url): url is string => typeof url === "string") : []),
  ].map(cleanUrl).filter((url): url is string => Boolean(url));
  const alchemyHost = typeof value.alchemyHost === "string" && value.alchemyHost.trim()
    ? value.alchemyHost.trim()
    : undefined;

  if (!key || !chainId || !explorer || !nativeSymbol || rpcUrls.length === 0) return null;

  return {
    key,
    chainId,
    name,
    explorer,
    nativeSymbol,
    seadropAddress,
    requiresSeaDropConfig: !seadropAddress,
    rpc: {
      ...(alchemyHost ? { alchemyHost } : {}),
      public: dedupe(rpcUrls),
    },
  };
}

function cloneChain(chain: ChainProfile): ChainProfile {
  return {
    ...chain,
    rpc: {
      ...chain.rpc,
      public: [...chain.rpc.public],
    },
  };
}

function readRegistryPath(path: string | undefined): string | undefined {
  if (!path || !path.trim()) return undefined;
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function cleanAddress(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  return ADDRESS_RE.test(value) ? value : undefined;
}

function cleanUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
