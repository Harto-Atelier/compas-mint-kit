import assert from "node:assert/strict";
import test from "node:test";
import { extractDropCalendarItems, fetchOpenSeaDropsFeed, normalizeDropItems } from "./opensea-drops-feed";

const CONTRACT = "0x03c1a58c74b6e046122272553099115bf0bba424";

const rawItem = {
  identifier: { contractAddress: CONTRACT, chain: { identifier: "ethereum" } },
  collection: {
    slug: "the-cheez-genesis",
    name: "The Cheez - Genesis",
    imageUrl: "https://example.com/logo.gif",
    isVerified: false,
    floorPrice: { pricePerItem: { token: { unit: 0.0021998, symbol: "ETH" } } },
    drop: { stages: [{ startTime: "2026-08-23T19:16:24.000Z", endTime: "2026-08-24T21:16:24.000Z" }] },
  },
  activeDropStage: { price: { token: { unit: 0, symbol: "ETH" } } },
  isMinting: true,
  isMintedOut: false,
};

test("extractDropCalendarItems reads OpenSea urql transport dropCalendar payloads", () => {
  const payload = JSON.stringify({ rehydrate: { "1": { data: { dropCalendar: { items: [rawItem] } } } } });
  const html = `<script>(window[Symbol.for("urql_transport")] ??= []).push(${payload})</script>`;
  const items = extractDropCalendarItems(html);
  assert.equal(items.length, 1);
  assert.equal(items[0].collection?.slug, "the-cheez-genesis");
});

test("normalizeDropItems builds deduped OpenSea-style mint cards", () => {
  const cards = normalizeDropItems([rawItem, rawItem]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].name, "The Cheez - Genesis");
  assert.equal(cards[0].floorPriceEth, 0.0022);
  assert.equal(cards[0].mintPriceEth, 0);
  assert.equal(cards[0].openseaUrl, "https://opensea.io/collection/the-cheez-genesis");
});

test("feed returns preview-only safety and clean HTTP errors", async () => {
  const fetchImpl = async () => new Response("nope", { status: 503 });
  const result = await fetchOpenSeaDropsFeed({ mode: "past", fetchImpl, limit: 10 });
  assert.equal(result.ok, false);
  assert.equal(result.safety.previewOnly, true);
  assert.equal(result.safety.broadcast, false);
  assert.equal(result.items.length, 0);
  assert.equal(result.ok ? undefined : result.error, "opensea-drops-http-503");
});
