/**
 * Holder position auto-detect — keyless Blockscout token instances read.
 *
 * Reads which tokenIds a holder wallet owns in a given ERC-721 collection via
 * GET {host}/api/v2/tokens/{contract}/instances?holder_address_hash={wallet}.
 *
 * Real observed response shape (eth.blockscout.com, 2026-08):
 *   { items: [{ id: "9977", token_type: "ERC-721", value: "1", owner: {...}, ... }],
 *     next_page_params: { holder_address_hash: "0x...", unique_token: 6085 } | null }
 *
 * Preview-only: this module only READS public data. Nothing signs or
 * broadcasts. tokenIds are never fabricated — an empty list is a valid result,
 * and any failure is surfaced through `error` with an empty tokenIds array.
 */

export interface RawInstanceItem {
  id?: string | number | null;
  token_type?: string | null;
  value?: string | null;
}

export interface HolderPositionsResult {
  schemaVersion: "compas-holder-positions.v1";
  generatedAt: string;
  wallet: string;
  contract: string;
  chain: string;
  source: "blockscout";
  tokenIds: string[];
  sampleTruncated: boolean;
  error?: string;
}

const BLOCKSCOUT_HOSTS: Record<string, string> = {
  ethereum: "https://eth.blockscout.com",
  base: "https://base.blockscout.com",
  robinhood: "https://robinhoodchain.blockscout.com",
};

/** Hard cap on pages fetched per call (50 instances per Blockscout page). */
const MAX_PAGES = 4;

const HEX_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/**
 * Pure normalizer: raw Blockscout instance items -> deduped tokenId strings.
 * Items without a usable `id` are dropped, never invented.
 */
export function normalizeInstanceTokenIds(items: RawInstanceItem[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (item == null) continue;
    const raw = item.id;
    if (raw === null || raw === undefined) continue;
    const id = String(raw).trim();
    if (id.length === 0) continue;
    seen.add(id);
  }
  return [...seen];
}

function baseResult(input: { wallet: string; contract: string; chain: string }): HolderPositionsResult {
  return {
    schemaVersion: "compas-holder-positions.v1",
    generatedAt: new Date().toISOString(),
    wallet: input.wallet,
    contract: input.contract,
    chain: input.chain,
    source: "blockscout",
    tokenIds: [],
    sampleTruncated: false,
  };
}

export async function fetchHolderPositions(input: {
  wallet: string;
  contract: string;
  chain: string;
  fetchImpl?: typeof fetch;
}): Promise<HolderPositionsResult> {
  const wallet = input.wallet.trim();
  const contract = input.contract.trim();
  const shape = { wallet, contract, chain: input.chain };

  if (!HEX_ADDRESS.test(wallet)) {
    return { ...baseResult(shape), error: "invalid wallet address" };
  }
  if (!HEX_ADDRESS.test(contract)) {
    return { ...baseResult(shape), error: "invalid contract address" };
  }
  const host = BLOCKSCOUT_HOSTS[input.chain];
  if (!host) {
    return { ...baseResult(shape), error: `unsupported chain ${input.chain}` };
  }

  const doFetch = input.fetchImpl ?? fetch;
  const collected: RawInstanceItem[] = [];
  let sampleTruncated = false;

  try {
    let pageParams: Record<string, unknown> | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(`${host}/api/v2/tokens/${contract}/instances`);
      url.searchParams.set("holder_address_hash", wallet);
      if (pageParams) {
        for (const [key, value] of Object.entries(pageParams)) {
          if (value !== null && value !== undefined) {
            url.searchParams.set(key, String(value));
          }
        }
      }
      const response = await doFetch(url.toString(), {
        signal: AbortSignal.timeout(9_000),
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        return { ...baseResult(shape), error: `blockscout-http-${response.status}` };
      }
      const body = (await response.json()) as {
        items?: RawInstanceItem[];
        next_page_params?: Record<string, unknown> | null;
      };
      if (Array.isArray(body.items)) {
        collected.push(...body.items);
      }
      pageParams = body.next_page_params ?? null;
      if (!pageParams) break;
      if (page === MAX_PAGES - 1) {
        // More pages exist beyond our cap — report a truncated sample honestly.
        sampleTruncated = true;
      }
    }
    return { ...baseResult(shape), tokenIds: normalizeInstanceTokenIds(collected), sampleTruncated };
  } catch (err) {
    const error = err instanceof Error && err.name === "TimeoutError" ? "blockscout-timeout" : "network-error";
    return { ...baseResult(shape), error };
  }
}
