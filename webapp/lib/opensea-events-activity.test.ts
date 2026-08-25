import assert from "node:assert/strict";
import test from "node:test";
import { computeActivityMetrics, fetchOpenSeaEventsActivity, normalizeOpenSeaEvents } from "./opensea-events-activity";

const ZERO = "0x0000000000000000000000000000000000000000";
const NOW = new Date("2026-08-25T12:00:00.000Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("item_transferred from zero address is a mint, otherwise a transfer", () => {
  const events = normalizeOpenSeaEvents([
    { event_type: "item_transferred", from_address: ZERO, to_address: "0x1111111111111111111111111111111111111111", nft: { identifier: "7" }, event_timestamp: nowSeconds, transaction: "0xabc" },
    { event_type: "transfer", from_address: ZERO, nft: { identifier: "8" }, event_timestamp: nowSeconds },
    { event_type: "item_transferred", from_address: "0x2222222222222222222222222222222222222222", nft: { identifier: "9" }, event_timestamp: nowSeconds },
  ]);
  assert.deepEqual(events.map((event) => event.action), ["mint", "mint", "transfer"]);
  assert.equal(events[0].tokenId, "7");
  assert.equal(events[0].txHash, "0xabc");
});

test("order events classify offers and listings; sale event_type is a sale", () => {
  const events = normalizeOpenSeaEvents([
    { event_type: "order", order_type: "item_offer", event_timestamp: nowSeconds },
    { event_type: "order", order_type: "collection_offer", event_timestamp: nowSeconds },
    { event_type: "order", order_type: "listing", event_timestamp: nowSeconds },
    { event_type: "sale", event_timestamp: nowSeconds, payment: { quantity: "50000000000000000", decimals: 18, symbol: "ETH" } },
    { event_type: "order", order_type: "unknown_type", event_timestamp: nowSeconds },
  ]);
  assert.deepEqual(events.map((event) => event.action), ["offer", "offer", "list", "sale"]);
  assert.equal(events[3].priceEth, 0.05);
});

test("metrics respect 30m/24h windows and compute average sale price", () => {
  const events = normalizeOpenSeaEvents([
    // mint 10 minutes ago → counts in 30m and 24h
    { event_type: "item_transferred", from_address: ZERO, event_timestamp: nowSeconds - 10 * 60 },
    // mint 2 hours ago → only 24h
    { event_type: "item_transferred", from_address: ZERO, event_timestamp: nowSeconds - 2 * 3600 },
    // mint 30 hours ago → outside both windows
    { event_type: "item_transferred", from_address: ZERO, event_timestamp: nowSeconds - 30 * 3600 },
    // two sales inside 24h with ETH prices 0.1 and 0.3 → avg 0.2
    { event_type: "sale", event_timestamp: nowSeconds - 3600, payment: { quantity: "100000000000000000", decimals: 18, symbol: "ETH" } },
    { event_type: "sale", event_timestamp: nowSeconds - 7200, payment: { quantity: "300000000000000000", decimals: 18, symbol: "WETH" } },
    // sale outside 24h ignored
    { event_type: "sale", event_timestamp: nowSeconds - 25 * 3600, payment: { quantity: "900000000000000000", decimals: 18, symbol: "ETH" } },
    // listing inside 24h
    { event_type: "order", order_type: "listing", event_timestamp: nowSeconds - 3600 },
  ]);
  const metrics = computeActivityMetrics(events, NOW);
  assert.equal(metrics.mintsLast30m, 1);
  assert.equal(metrics.mintsLast24h, 2);
  assert.equal(metrics.salesLast24h, 2);
  assert.equal(metrics.avgSalePriceEth24h, 0.2);
  assert.equal(metrics.listingsLast24h, 1);
  assert.equal(metrics.lastMintAt, new Date((nowSeconds - 10 * 60) * 1000).toISOString());
});

test("fetch returns live snapshot with metrics from asset_events", async () => {
  const snapshot = await fetchOpenSeaEventsActivity({
    slug: "demo-drop",
    apiKey: "test-key",
    now: NOW,
    fetchImpl: async () =>
      jsonResponse({
        asset_events: [
          { event_type: "item_transferred", from_address: ZERO, event_timestamp: nowSeconds - 60, transaction: "0xdead" },
          { event_type: "sale", event_timestamp: nowSeconds - 120, payment: { quantity: "200000000000000000", decimals: 18, symbol: "ETH" } },
        ],
      }),
  });
  assert.equal(snapshot.status, "live");
  assert.equal(snapshot.eventCount, 2);
  assert.equal(snapshot.metrics.mintsLast30m, 1);
  assert.equal(snapshot.metrics.salesLast24h, 1);
  assert.equal(snapshot.metrics.avgSalePriceEth24h, 0.2);
  assert.equal(snapshot.error, undefined);
});

test("fetch reports opensea-http-401 without fabricating metrics", async () => {
  const snapshot = await fetchOpenSeaEventsActivity({
    slug: "demo-drop",
    apiKey: "expired-key",
    now: NOW,
    fetchImpl: async () => jsonResponse({ errors: ["API key has expired"] }, 401),
  });
  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.error, "opensea-http-401");
  assert.equal(snapshot.eventCount, 0);
  assert.equal(snapshot.metrics.mintsLast24h, 0);
  assert.equal(snapshot.metrics.avgSalePriceEth24h, null);
});

test("fetch reports opensea-http-429 on rate limit", async () => {
  const snapshot = await fetchOpenSeaEventsActivity({
    slug: "demo-drop",
    apiKey: "hot-key",
    now: NOW,
    fetchImpl: async () => jsonResponse({ errors: ["throttled"] }, 429),
  });
  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.error, "opensea-http-429");
});

test("fetch reports timeout when the request aborts", async () => {
  const snapshot = await fetchOpenSeaEventsActivity({
    slug: "demo-drop",
    apiKey: "slow-key",
    now: NOW,
    fetchImpl: async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    },
  });
  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.error, "timeout");
});

test("fetch reports not-configured when no API key is present", async () => {
  const snapshot = await fetchOpenSeaEventsActivity({
    slug: "demo-drop",
    apiKey: "",
    now: NOW,
    fetchImpl: async () => {
      throw new Error("must not fetch without a key");
    },
  });
  assert.equal(snapshot.status, "not-configured");
  assert.equal(snapshot.error, "not-configured");
  assert.equal(snapshot.eventCount, 0);
});

test("empty asset_events yields unavailable, never fabricated data", async () => {
  const snapshot = await fetchOpenSeaEventsActivity({
    slug: "demo-drop",
    apiKey: "test-key",
    now: NOW,
    fetchImpl: async () => jsonResponse({ asset_events: [] }),
  });
  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.eventCount, 0);
  assert.equal(snapshot.metrics.lastMintAt, null);
});
