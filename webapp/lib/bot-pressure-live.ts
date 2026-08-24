/**
 * Live bot pressure reads — keyless Blockscout transfers only.
 *
 * Honest scope: without a marketplace events key (OpenSea Events scope) we can
 * NOT see listings/offers. From raw ERC-721 transfers we CAN derive:
 *  - mint share (transfers from 0x0)
 *  - transfer velocity (events per hour)
 *  - receiver concentration (top wallet share of recent mints)
 *  - multi-mint wallets (wallets receiving 3+ mints in the window)
 * Fields we cannot observe are returned as `null` and surfaced as unavailable —
 * the UI keeps manual inputs for those. No fabricated metrics.
 */

export interface RawTransferItem {
  from: { hash: string; is_contract?: boolean };
  to: { hash: string; is_contract?: boolean };
  timestamp: string;
  total?: { token_id?: string | null; value?: string | null };
}

export interface LivePressureMetrics {
  schemaVersion: "compas-live-pressure.v1";
  generatedAt: string;
  contract: string;
  chain: string;
  source: "blockscout";
  sampleSize: number;
  windowHours: number | null;
  mintSharePercent: number | null;
  transfersPerHour: number | null;
  topReceiverSharePercent: number | null;
  multiMintWalletPercent: number | null;
  suspiciousWalletCount: number | null;
  /** Derived suggestion for the manual panel inputs. */
  suggested: {
    freshWalletMintPercent: number;
    rapidListingPercent: number | null; // null = not observable keyless
    undercutVelocityPercent: number | null; // null = not observable keyless
  };
  unavailable: string[];
  error?: string;
}

const BLOCKSCOUT_HOSTS: Record<string, string> = {
  ethereum: "https://eth.blockscout.com",
  base: "https://base.blockscout.com",
  robinhood: "https://robinhoodchain.blockscout.com",
};

const ZERO = "0x0000000000000000000000000000000000000000";

export function normalizeTransfers(items: RawTransferItem[], input: { contract: string; chain: string; now?: Date }): LivePressureMetrics {
  const now = input.now ?? new Date();
  const base: LivePressureMetrics = {
    schemaVersion: "compas-live-pressure.v1",
    generatedAt: now.toISOString(),
    contract: input.contract,
    chain: input.chain,
    source: "blockscout",
    sampleSize: items.length,
    windowHours: null,
    mintSharePercent: null,
    transfersPerHour: null,
    topReceiverSharePercent: null,
    multiMintWalletPercent: null,
    suspiciousWalletCount: null,
    suggested: { freshWalletMintPercent: 0, rapidListingPercent: null, undercutVelocityPercent: null },
    unavailable: ["rapidListingPercent (needs marketplace events key)", "undercutVelocityPercent (needs floor/listing data)"],
  };
  if (items.length === 0) return base;

  const timestamps = items.map((item) => Date.parse(item.timestamp)).filter((ms) => Number.isFinite(ms));
  const oldest = Math.min(...timestamps);
  const newest = Math.max(...timestamps);
  const windowHours = Math.max((newest - oldest) / 3_600_000, 1 / 60);

  const mints = items.filter((item) => item.from.hash.toLowerCase() === ZERO);
  const mintShare = (mints.length / items.length) * 100;

  const receiverCounts = new Map<string, number>();
  for (const mint of mints) {
    const to = mint.to.hash.toLowerCase();
    receiverCounts.set(to, (receiverCounts.get(to) ?? 0) + 1);
  }
  const uniqueReceivers = receiverCounts.size;
  const topReceiver = uniqueReceivers > 0 ? Math.max(...receiverCounts.values()) : 0;
  const topReceiverShare = mints.length > 0 ? (topReceiver / mints.length) * 100 : 0;
  const multiMintWallets = [...receiverCounts.values()].filter((count) => count >= 3).length;
  const multiMintPercent = uniqueReceivers > 0 ? (multiMintWallets / uniqueReceivers) * 100 : 0;

  // Heuristic: bot-shaped mint demand = concentration + multi-mint share.
  const freshWalletMintPercent = Math.round(Math.min(100, topReceiverShare * 0.5 + multiMintPercent * 0.8));

  return {
    ...base,
    windowHours: round2(windowHours),
    mintSharePercent: round2(mintShare),
    transfersPerHour: round2(items.length / windowHours),
    topReceiverSharePercent: round2(topReceiverShare),
    multiMintWalletPercent: round2(multiMintPercent),
    suspiciousWalletCount: multiMintWallets,
    suggested: { freshWalletMintPercent, rapidListingPercent: null, undercutVelocityPercent: null },
  };
}

export async function fetchLivePressure(input: { contract: string; chain: string; fetchImpl?: typeof fetch }): Promise<LivePressureMetrics> {
  const contract = input.contract.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(contract)) {
    return { ...normalizeTransfers([], { contract, chain: input.chain }), error: "invalid contract address" };
  }
  const host = BLOCKSCOUT_HOSTS[input.chain];
  if (!host) {
    return { ...normalizeTransfers([], { contract, chain: input.chain }), error: `unsupported chain ${input.chain}` };
  }
  const doFetch = input.fetchImpl ?? fetch;
  try {
    const response = await doFetch(`${host}/api/v2/tokens/${contract}/transfers`, { signal: AbortSignal.timeout(9_000), headers: { accept: "application/json" } });
    if (!response.ok) {
      return { ...normalizeTransfers([], { contract, chain: input.chain }), error: `blockscout-http-${response.status}` };
    }
    const body = (await response.json()) as { items?: RawTransferItem[] };
    return normalizeTransfers(Array.isArray(body.items) ? body.items : [], { contract, chain: input.chain });
  } catch (err) {
    return { ...normalizeTransfers([], { contract, chain: input.chain }), error: err instanceof Error ? err.name === "TimeoutError" ? "blockscout-timeout" : "network-error" : "network-error" };
  }
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}
