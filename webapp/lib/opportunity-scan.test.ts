import assert from "node:assert/strict";
import test from "node:test";
import { applyActivityBoost, runOpportunityScan, scoreDiscovery } from "./opportunity-scan";
import type { MintDiscoveryResponse } from "./mint-types";
import type { OpenSeaEventsActivitySnapshot } from "./opensea-events-activity";

const baseDiscovery: MintDiscoveryResponse = {
  ok: true,
  query: "demo",
  resolvedAt: "2026-08-23T00:00:00.000Z",
  collection: {
    name: "Demo Drop",
    address: "0x1111111111111111111111111111111111111111",
    chain: { key: "base", name: "Base", chainId: 8453, explorer: "https://basescan.org", nativeSymbol: "ETH" },
    openseaUrl: "https://opensea.io/collection/demo",
    explorerUrl: "https://basescan.org/address/0x1111111111111111111111111111111111111111",
    source: "address",
  },
  signals: [],
  stages: [
    { id: "public", label: "PUBLIC", source: "onchain-seadrop", status: "live", startTime: null, endTime: null, priceEth: "0.01", maxPerWallet: 1, eligible: "checked", summary: "ok", feeRecipient: "0x2222222222222222222222222222222222222222", warnings: [] },
  ],
  warnings: [],
};

test("opportunity scoring promotes executable public SeaDrop stages", () => {
  const scored = scoreDiscovery(baseDiscovery);
  assert.equal(scored.signal, "ready");
  assert.equal(scored.nextAction, "Prepare canary");
  assert.equal(scored.executableStageCount, 1);
  assert.ok(scored.score > 40);
});

test("opportunity scan is preview-only and strips secret-shaped watchlist input", async () => {
  const result = await runOpportunityScan({
    items: [
      { query: "demo", chain: "base" },
      { query: `0x${"a".repeat(64)}`, chain: "base" },
      { query: "demo", chain: "base" },
    ],
    now: new Date("2026-08-23T00:00:00.000Z"),
    discoverer: async () => baseDiscovery,
  });

  assert.equal(result.mode, "preview-only");
  assert.equal(result.safety.execution, "none");
  assert.equal(result.safety.broadcast, false);
  assert.equal(result.safety.custody, false);
  assert.equal(result.checked, 1);
  assert.equal(result.candidates.length, 1);
});

function activitySnapshot(overrides: Partial<OpenSeaEventsActivitySnapshot["metrics"]>, status: OpenSeaEventsActivitySnapshot["status"] = "live", error?: string): OpenSeaEventsActivitySnapshot {
  return {
    source: "opensea-events-v2",
    slug: "demo",
    status,
    ...(error ? { error } : {}),
    fetchedAt: "2026-08-23T00:00:00.000Z",
    eventCount: 10,
    metrics: { mintsLast30m: 0, mintsLast24h: 0, salesLast24h: 0, avgSalePriceEth24h: null, listingsLast24h: 0, lastMintAt: null, ...overrides },
  };
}

test("live minting momentum boosts score by 10 and sales by 5, capped at 100", () => {
  const base = scoreDiscovery(baseDiscovery);
  const boosted = applyActivityBoost(base, activitySnapshot({ mintsLast30m: 2, mintsLast24h: 6, salesLast24h: 5, avgSalePriceEth24h: 0.12 }));
  assert.equal(boosted.score, Math.min(100, base.score + 15));
  assert.equal(boosted.activity?.status, "live");
  assert.equal(boosted.activity?.mintsLast30m, 2);

  const nearCap = applyActivityBoost({ ...base, score: 95 }, activitySnapshot({ mintsLast30m: 1, salesLast24h: 9 }));
  assert.equal(nearCap.score, 100);

  const mintsOnly = applyActivityBoost(base, activitySnapshot({ mintsLast30m: 1, salesLast24h: 3 }));
  assert.equal(mintsOnly.score, base.score + 10);
});

test("unavailable activity attaches source status without boosting the score", () => {
  const base = scoreDiscovery(baseDiscovery);
  const withError = applyActivityBoost(base, activitySnapshot({ mintsLast30m: 0 }, "unavailable", "opensea-http-401"));
  assert.equal(withError.score, base.score);
  assert.equal(withError.activity?.status, "unavailable");
  assert.equal(withError.activity?.error, "opensea-http-401");
});

test("scan enriches candidates with activity when the collection has a slug and survives fetcher failure", async () => {
  const discoveryWithSlug: MintDiscoveryResponse = { ...baseDiscovery, collection: { ...baseDiscovery.collection, slug: "demo" } };
  const enriched = await runOpportunityScan({
    items: [{ query: "demo", chain: "base" }],
    now: new Date("2026-08-23T00:00:00.000Z"),
    discoverer: async () => discoveryWithSlug,
    activityFetcher: async () => activitySnapshot({ mintsLast30m: 1, salesLast24h: 4 }),
  });
  assert.equal(enriched.candidates[0].activity?.status, "live");
  assert.equal(enriched.candidates[0].score, Math.min(100, scoreDiscovery(discoveryWithSlug).score + 15));

  const failing = await runOpportunityScan({
    items: [{ query: "demo", chain: "base" }],
    now: new Date("2026-08-23T00:00:00.000Z"),
    discoverer: async () => discoveryWithSlug,
    activityFetcher: async () => {
      throw new Error("boom");
    },
  });
  assert.equal(failing.candidates.length, 1);
  assert.equal(failing.candidates[0].activity, undefined);
  assert.equal(failing.candidates[0].score, scoreDiscovery(discoveryWithSlug).score);
});
