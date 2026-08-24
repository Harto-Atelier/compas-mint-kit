export type OpenSeaDropsMode = "live" | "upcoming" | "past";

export interface OpenSeaDropCard {
  slug: string;
  name: string;
  contractAddress: string;
  chain: string;
  imageUrl: string | null;
  openseaUrl: string;
  floorPriceEth: number | null;
  floorSymbol: string | null;
  mintPriceEth: number | null;
  isMinting: boolean;
  isMintedOut: boolean;
  isVerified: boolean;
  startTime: string | null;
  endTime: string | null;
}

export interface OpenSeaDropsFeedResult {
  ok: true;
  schemaVersion: "compas-opensea-drops-feed.v1";
  mode: OpenSeaDropsMode;
  source: "opensea-drops-page";
  fetchedAt: string;
  safety: {
    previewOnly: true;
    execution: "none";
    broadcast: false;
    custody: false;
  };
  items: OpenSeaDropCard[];
  warnings: string[];
}

export interface OpenSeaDropsFeedError {
  ok: false;
  error: string;
  schemaVersion: "compas-opensea-drops-feed.v1";
  mode: OpenSeaDropsMode;
  source: "opensea-drops-page";
  fetchedAt: string;
  safety: OpenSeaDropsFeedResult["safety"];
  items: [];
  warnings: string[];
}

type RawDropItem = {
  identifier?: { contractAddress?: string; chain?: { identifier?: string } };
  collection?: {
    slug?: string;
    name?: string;
    imageUrl?: string | null;
    featuredImageUrl?: string | null;
    bannerImageUrl?: string | null;
    isVerified?: boolean;
    hero?: { desktopHeroMedia?: { imageUrl?: string | null }; mobileHeroMedia?: { imageUrl?: string | null } } | null;
    floorPrice?: { pricePerItem?: { token?: { unit?: number; symbol?: string } } | null } | null;
    drop?: { stages?: { startTime?: string; endTime?: string }[]; totalSupply?: number; maxSupply?: number } | null;
  };
  activeDropStage?: { price?: { token?: { unit?: number; symbol?: string } } | null } | null;
  stages?: { startTime?: string; endTime?: string }[];
  isMinting?: boolean;
  isMintedOut?: boolean;
};

const PAGE_BY_MODE: Record<OpenSeaDropsMode, string> = {
  live: "https://opensea.io/drops",
  upcoming: "https://opensea.io/drops",
  past: "https://opensea.io/drops/past",
};

const SAFETY: OpenSeaDropsFeedResult["safety"] = {
  previewOnly: true,
  execution: "none",
  broadcast: false,
  custody: false,
};

export async function fetchOpenSeaDropsFeed(input: { mode?: string; fetchImpl?: typeof fetch; limit?: number }): Promise<OpenSeaDropsFeedResult | OpenSeaDropsFeedError> {
  const mode = normalizeMode(input.mode);
  const fetchedAt = new Date().toISOString();
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 60);
  const doFetch = input.fetchImpl ?? fetch;

  try {
    const response = await doFetch(PAGE_BY_MODE[mode], {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "Mozilla/5.0 CompasMintKit/1.0 OpenSeaDropsFeed",
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!response.ok) return errorResult(mode, fetchedAt, `opensea-drops-http-${response.status}`);
    const html = await response.text();
    const rawItems = extractDropCalendarItems(html);
    const now = Date.now();
    const normalized = normalizeDropItems(rawItems)
      .filter((item) => filterByMode(item, mode, now))
      .slice(0, limit);
    return {
      ok: true,
      schemaVersion: "compas-opensea-drops-feed.v1",
      mode,
      source: "opensea-drops-page",
      fetchedAt,
      safety: SAFETY,
      items: normalized,
      warnings: [
        "Read-only OpenSea page snapshot. Use Discover mint on a card before planning or broadcast.",
        "Floor/mint prices are display data from OpenSea; onchain SeaDrop config is re-read separately by the signer flow.",
      ],
    };
  } catch (err) {
    const code = err instanceof Error && err.name === "TimeoutError" ? "opensea-drops-timeout" : "opensea-drops-network-error";
    return errorResult(mode, fetchedAt, code);
  }
}

export function normalizeDropItems(items: RawDropItem[]): OpenSeaDropCard[] {
  const seen = new Set<string>();
  const cards: OpenSeaDropCard[] = [];
  for (const item of items) {
    const collection = item.collection;
    const slug = collection?.slug?.trim();
    const name = collection?.name?.trim();
    const contractAddress = item.identifier?.contractAddress?.trim();
    const chain = item.identifier?.chain?.identifier?.trim() || collection?.drop ? item.identifier?.chain?.identifier?.trim() || "ethereum" : "ethereum";
    if (!slug || !name || !contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) continue;
    const key = `${chain}:${contractAddress.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const stages = item.stages?.length ? item.stages : collection?.drop?.stages ?? [];
    cards.push({
      slug,
      name,
      contractAddress,
      chain,
      imageUrl: collection?.hero?.desktopHeroMedia?.imageUrl || collection?.featuredImageUrl || collection?.bannerImageUrl || collection?.imageUrl || null,
      openseaUrl: `https://opensea.io/collection/${slug}`,
      floorPriceEth: numberOrNull(collection?.floorPrice?.pricePerItem?.token?.unit),
      floorSymbol: collection?.floorPrice?.pricePerItem?.token?.symbol ?? null,
      mintPriceEth: numberOrNull(item.activeDropStage?.price?.token?.unit),
      isMinting: item.isMinting === true,
      isMintedOut: item.isMintedOut === true,
      isVerified: collection?.isVerified === true,
      startTime: firstStageTime(stages, "startTime"),
      endTime: lastStageTime(stages, "endTime"),
    });
  }
  return cards;
}

export function extractDropCalendarItems(html: string): RawDropItem[] {
  const items: RawDropItem[] = [];
  const scriptRe = /window\[Symbol\.for\("urql_transport"\)\][\s\S]*?\.push\((\{"rehydrate"[\s\S]*?\})\)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    try {
      const payload = JSON.parse(match[1]) as { rehydrate?: Record<string, { data?: { dropCalendar?: { items?: RawDropItem[] } } }> };
      for (const entry of Object.values(payload.rehydrate ?? {})) {
        const found = entry.data?.dropCalendar?.items;
        if (Array.isArray(found)) items.push(...found);
      }
    } catch {
      // Ignore unrelated/partial hydration chunks. Missing data becomes a clean empty feed.
    }
  }
  return items;
}

function normalizeMode(value?: string): OpenSeaDropsMode {
  if (value === "upcoming" || value === "past") return value;
  return "live";
}

function filterByMode(item: OpenSeaDropCard, mode: OpenSeaDropsMode, now: number): boolean {
  if (mode === "live") return item.isMinting || (dateMs(item.startTime) <= now && now <= dateMs(item.endTime));
  if (mode === "upcoming") return !item.isMinting && dateMs(item.startTime) > now;
  return item.isMintedOut || dateMs(item.endTime) < now;
}

function dateMs(value: string | null): number {
  if (!value) return Number.NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(6)) : null;
}

function firstStageTime(stages: { startTime?: string; endTime?: string }[], key: "startTime" | "endTime"): string | null {
  const values = stages.map((stage) => stage[key]).filter((value): value is string => Boolean(value)).sort();
  return values[0] ?? null;
}

function lastStageTime(stages: { startTime?: string; endTime?: string }[], key: "startTime" | "endTime"): string | null {
  const values = stages.map((stage) => stage[key]).filter((value): value is string => Boolean(value)).sort();
  return values.at(-1) ?? null;
}

function errorResult(mode: OpenSeaDropsMode, fetchedAt: string, error: string): OpenSeaDropsFeedError {
  return {
    ok: false,
    error,
    schemaVersion: "compas-opensea-drops-feed.v1",
    mode,
    source: "opensea-drops-page",
    fetchedAt,
    safety: SAFETY,
    items: [],
    warnings: ["OpenSea drops feed unavailable. Paste a collection slug/address manually to continue."],
  };
}
