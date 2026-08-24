import assert from "node:assert/strict";
import test from "node:test";
import { fetchLivePressure, normalizeTransfers, type RawTransferItem } from "./bot-pressure-live";

const ZERO = "0x0000000000000000000000000000000000000000";
const BOT = "0xb0tb0tb0tb0tb0tb0tb0tb0tb0tb0tb0tb0tb0t1".slice(0, 42);

function mint(to: string, minutesAgo: number): RawTransferItem {
  return { from: { hash: ZERO }, to: { hash: to }, timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString() };
}

test("live pressure derives mint share and concentration from real transfers only", () => {
  const items: RawTransferItem[] = [
    mint("0x1111111111111111111111111111111111111111", 50),
    mint(BOT, 40),
    mint(BOT, 30),
    mint(BOT, 20),
    { from: { hash: "0x2222222222222222222222222222222222222222" }, to: { hash: "0x3333333333333333333333333333333333333333" }, timestamp: new Date(Date.now() - 10 * 60_000).toISOString() },
  ];
  const metrics = normalizeTransfers(items, { contract: "0x4444444444444444444444444444444444444444", chain: "ethereum" });
  assert.equal(metrics.sampleSize, 5);
  assert.equal(metrics.mintSharePercent, 80);
  assert.equal(metrics.topReceiverSharePercent, 75);
  assert.equal(metrics.suspiciousWalletCount, 1);
  assert.ok(metrics.suggested.freshWalletMintPercent > 0);
});

test("live pressure marks unobservable listing metrics as unavailable, never fabricated", () => {
  const metrics = normalizeTransfers([mint(BOT, 5)], { contract: "0x4444444444444444444444444444444444444444", chain: "base" });
  assert.equal(metrics.suggested.rapidListingPercent, null);
  assert.equal(metrics.suggested.undercutVelocityPercent, null);
  assert.ok(metrics.unavailable.length >= 2);
});

test("live pressure returns real error codes for invalid input and upstream failure", async () => {
  const invalid = await fetchLivePressure({ contract: "not-an-address", chain: "ethereum" });
  assert.equal(invalid.error, "invalid contract address");

  const badChain = await fetchLivePressure({ contract: "0x4444444444444444444444444444444444444444", chain: "solana" });
  assert.match(badChain.error ?? "", /unsupported chain/);

  const failing = await fetchLivePressure({
    contract: "0x4444444444444444444444444444444444444444",
    chain: "ethereum",
    fetchImpl: (async () => new Response("{}", { status: 503 })) as typeof fetch,
  });
  assert.equal(failing.error, "blockscout-http-503");
});
