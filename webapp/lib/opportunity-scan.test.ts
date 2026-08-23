import assert from "node:assert/strict";
import test from "node:test";
import { runOpportunityScan, scoreDiscovery } from "./opportunity-scan";
import type { MintDiscoveryResponse } from "./mint-types";

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
