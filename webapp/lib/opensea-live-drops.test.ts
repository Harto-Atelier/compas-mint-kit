import assert from "node:assert/strict";
import test from "node:test";
import type { MintDiscoveryResponse } from "./mint-types";
import { fetchVerifiedLiveDrops } from "./opensea-live-drops";
import type { OpenSeaDropCard, OpenSeaDropsFeedResult, OpenSeaDropsMode } from "./opensea-drops-feed";

const card = (slug: string, address: string, overrides: Partial<OpenSeaDropCard> = {}): OpenSeaDropCard => ({
  slug,
  name: slug,
  contractAddress: address,
  chain: "ethereum",
  imageUrl: null,
  openseaUrl: `https://opensea.io/collection/${slug}`,
  floorPriceEth: null,
  floorSymbol: null,
  mintPriceEth: null,
  isMinting: false,
  isMintedOut: true,
  isVerified: false,
  startTime: null,
  endTime: null,
  ...overrides,
});

function feed(mode: OpenSeaDropsMode, items: OpenSeaDropCard[]): OpenSeaDropsFeedResult {
  return {
    ok: true,
    schemaVersion: "compas-opensea-drops-feed.v1",
    mode,
    source: "opensea-drops-page",
    fetchedAt: "2026-08-25T00:00:00.000Z",
    safety: { previewOnly: true, execution: "none", broadcast: false, custody: false },
    items,
    warnings: [],
  };
}

function discovery(status: "live" | "upcoming" | "ended"): MintDiscoveryResponse {
  return {
    ok: true,
    query: "demo",
    resolvedAt: "2026-08-25T00:00:00.000Z",
    collection: {
      name: "Demo",
      address: "0x2222222222222222222222222222222222222222",
      chain: { key: "ethereum", name: "Ethereum", chainId: 1, explorer: "https://etherscan.io", nativeSymbol: "ETH" },
      openseaUrl: "https://opensea.io/collection/demo",
      explorerUrl: "https://etherscan.io/address/0x2222222222222222222222222222222222222222",
      source: "address",
    },
    signals: [],
    stages: [{
      id: "public",
      label: "PUBLIC",
      source: "onchain-seadrop",
      status,
      startTime: "2026-08-25T00:00:00.000Z",
      endTime: "2026-09-01T00:00:00.000Z",
      priceEth: "0.01",
      maxPerWallet: 3,
      eligible: "checked",
      summary: "onchain",
      feeRecipient: "0x3333333333333333333333333333333333333333",
      warnings: [],
    }],
    warnings: [],
  };
}

test("restores OpenSea Past cards when SeaDrop is still live onchain", async () => {
  const stalePast = card("stale-open", "0x2222222222222222222222222222222222222222");
  const result = await fetchVerifiedLiveDrops({
    feedFetcher: async ({ mode }) => feed(mode === "past" ? "past" : "live", mode === "past" ? [stalePast] : []),
    discoverer: async () => discovery("live"),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].slug, "stale-open");
  assert.equal(result.items[0].isMinting, true);
  assert.equal(result.items[0].isMintedOut, false);
  assert.match(result.warnings.join(" "), /restored after live SeaDrop verification/);
});

test("does not promote Past cards whose SeaDrop stage ended", async () => {
  const closed = card("closed", "0x4444444444444444444444444444444444444444");
  const result = await fetchVerifiedLiveDrops({
    feedFetcher: async ({ mode }) => feed(mode === "past" ? "past" : "live", mode === "past" ? [closed] : []),
    discoverer: async () => discovery("ended"),
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.items.length, 0);
});

test("dedupes direct Live cards before checking Past candidates", async () => {
  const same = card("same", "0x5555555555555555555555555555555555555555", { isMinting: true, isMintedOut: false });
  let discoveries = 0;
  const result = await fetchVerifiedLiveDrops({
    feedFetcher: async ({ mode }) => feed(mode === "past" ? "past" : "live", [same]),
    discoverer: async () => {
      discoveries += 1;
      return discovery("live");
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.items.length, 1);
  assert.equal(discoveries, 0);
});
