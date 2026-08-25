export type OpenSeaActivityAction = "mint" | "sale" | "list" | "offer" | "transfer";

export interface OpenSeaActivityEvent {
  action: OpenSeaActivityAction;
  tokenId?: string;
  priceEth?: number;
  timestamp: number;
  txHash?: string;
}

export interface OpenSeaActivityMetrics {
  mintsLast30m: number;
  mintsLast24h: number;
  salesLast24h: number;
  avgSalePriceEth24h: number | null;
  listingsLast24h: number;
  lastMintAt: string | null;
}

export interface OpenSeaEventsActivitySnapshot {
  source: "opensea-events-v2";
  slug: string;
  status: "live" | "unavailable" | "not-configured";
  error?: string;
  fetchedAt: string;
  eventCount: number;
  /** Normalized events backing the metrics — reused by downstream planners (Market Fighter). */
  events: OpenSeaActivityEvent[];
  metrics: OpenSeaActivityMetrics;
}

type RawOpenSeaEvent = {
  event_type?: string;
  order_type?: string;
  from_address?: string;
  to_address?: string;
  nft?: { identifier?: string | number } | null;
  asset?: { identifier?: string | number } | null;
  payment?: { quantity?: string | number; decimals?: number; symbol?: string } | null;
  event_timestamp?: number | string;
  transaction?: string | { hash?: string } | null;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const ETH_SYMBOLS = new Set(["ETH", "WETH"]);

export async function fetchOpenSeaEventsActivity(input: { slug: string; fetchImpl?: typeof fetch; apiKey?: string; now?: Date }): Promise<OpenSeaEventsActivitySnapshot> {
  const fetchedAt = (input.now ?? new Date()).toISOString();
  const slug = input.slug.trim().toLowerCase();
  const apiKey = input.apiKey ?? process.env.OPENSEA_API_KEY;
  if (!apiKey) return snapshot(slug, fetchedAt, "not-configured", [], "not-configured");
  const doFetch = input.fetchImpl ?? fetch;

  try {
    const params = new URLSearchParams({ limit: "50" });
    for (const eventType of ["sale", "transfer", "order"]) params.append("event_type", eventType);
    const response = await doFetch(`https://api.opensea.io/api/v2/events/collection/${encodeURIComponent(slug)}?${params.toString()}`, {
      headers: { accept: "application/json", "x-api-key": apiKey },
      signal: AbortSignal.timeout(9_000),
      cache: "no-store",
    });
    if (!response.ok) return snapshot(slug, fetchedAt, "unavailable", [], `opensea-http-${response.status}`);
    const body = (await response.json()) as { asset_events?: RawOpenSeaEvent[] };
    const events = normalizeOpenSeaEvents(Array.isArray(body.asset_events) ? body.asset_events : []);
    if (events.length === 0) return snapshot(slug, fetchedAt, "unavailable", []);
    return snapshot(slug, fetchedAt, "live", events, undefined, input.now);
  } catch (err) {
    const code = err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network-error";
    return snapshot(slug, fetchedAt, "unavailable", [], code);
  }
}

export function normalizeOpenSeaEvents(rawEvents: RawOpenSeaEvent[]): OpenSeaActivityEvent[] {
  const events: OpenSeaActivityEvent[] = [];
  for (const raw of rawEvents) {
    const action = classifyEvent(raw);
    if (!action) continue;
    const timestamp = timestampSeconds(raw.event_timestamp);
    if (timestamp === null) continue;
    const tokenId = tokenIdOf(raw);
    const priceEth = priceEthOf(raw);
    const txHash = txHashOf(raw);
    events.push({
      action,
      ...(tokenId !== undefined ? { tokenId } : {}),
      ...(priceEth !== undefined ? { priceEth } : {}),
      timestamp,
      ...(txHash !== undefined ? { txHash } : {}),
    });
  }
  return events;
}

export function computeActivityMetrics(events: OpenSeaActivityEvent[], now: Date = new Date()): OpenSeaActivityMetrics {
  const nowMs = now.getTime();
  const inWindow = (event: OpenSeaActivityEvent, windowMs: number) => {
    const ageMs = nowMs - event.timestamp * 1000;
    return ageMs >= 0 && ageMs <= windowMs;
  };
  const mints24h = events.filter((event) => event.action === "mint" && inWindow(event, TWENTY_FOUR_HOURS_MS));
  const sales24h = events.filter((event) => event.action === "sale" && inWindow(event, TWENTY_FOUR_HOURS_MS));
  const salePrices = sales24h.map((event) => event.priceEth).filter((price): price is number => typeof price === "number" && Number.isFinite(price));
  const lastMintTs = events.filter((event) => event.action === "mint").reduce<number | null>((latest, event) => (latest === null || event.timestamp > latest ? event.timestamp : latest), null);

  return {
    mintsLast30m: mints24h.filter((event) => inWindow(event, THIRTY_MINUTES_MS)).length,
    mintsLast24h: mints24h.length,
    salesLast24h: sales24h.length,
    avgSalePriceEth24h: salePrices.length ? Number((salePrices.reduce((sum, price) => sum + price, 0) / salePrices.length).toFixed(6)) : null,
    listingsLast24h: events.filter((event) => event.action === "list" && inWindow(event, TWENTY_FOUR_HOURS_MS)).length,
    lastMintAt: lastMintTs !== null ? new Date(lastMintTs * 1000).toISOString() : null,
  };
}

function classifyEvent(raw: RawOpenSeaEvent): OpenSeaActivityAction | null {
  const eventType = raw.event_type?.toLowerCase();
  if (eventType === "sale") return "sale";
  if (eventType === "transfer" || eventType === "item_transferred") {
    // OpenSea reports mints as transfers from the zero address.
    return raw.from_address?.toLowerCase() === ZERO_ADDRESS ? "mint" : "transfer";
  }
  if (eventType === "order") {
    const orderType = raw.order_type?.toLowerCase();
    if (orderType === "item_offer" || orderType === "collection_offer" || orderType === "trait_offer") return "offer";
    if (orderType === "listing" || orderType === "auction") return "list";
    return null;
  }
  return null;
}

function timestampSeconds(value: RawOpenSeaEvent["event_timestamp"]): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return null;
}

function tokenIdOf(raw: RawOpenSeaEvent): string | undefined {
  const identifier = raw.nft?.identifier ?? raw.asset?.identifier;
  if (typeof identifier === "string" && identifier.trim()) return identifier.trim();
  if (typeof identifier === "number" && Number.isFinite(identifier)) return String(identifier);
  return undefined;
}

function priceEthOf(raw: RawOpenSeaEvent): number | undefined {
  const payment = raw.payment;
  if (!payment) return undefined;
  const symbol = payment.symbol?.toUpperCase();
  if (symbol && !ETH_SYMBOLS.has(symbol)) return undefined;
  const quantity = typeof payment.quantity === "string" ? Number(payment.quantity) : payment.quantity;
  const decimals = typeof payment.decimals === "number" ? payment.decimals : 18;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) return undefined;
  return Number((quantity / 10 ** decimals).toFixed(6));
}

function txHashOf(raw: RawOpenSeaEvent): string | undefined {
  if (typeof raw.transaction === "string" && raw.transaction.trim()) return raw.transaction.trim();
  if (raw.transaction && typeof raw.transaction === "object" && typeof raw.transaction.hash === "string" && raw.transaction.hash.trim()) return raw.transaction.hash.trim();
  return undefined;
}

function snapshot(slug: string, fetchedAt: string, status: OpenSeaEventsActivitySnapshot["status"], events: OpenSeaActivityEvent[], error?: string, now?: Date): OpenSeaEventsActivitySnapshot {
  return {
    source: "opensea-events-v2",
    slug,
    status,
    ...(error ? { error } : {}),
    fetchedAt,
    eventCount: events.length,
    events,
    metrics: computeActivityMetrics(events, now ?? new Date(fetchedAt)),
  };
}
