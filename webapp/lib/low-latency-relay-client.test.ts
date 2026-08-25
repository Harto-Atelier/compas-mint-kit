import assert from "node:assert/strict";
import test from "node:test";

import { BrowserRawSignedTransaction, type BrowserSignedMint } from "./browser-broadcast";
import { fireSignedMintsViaRelay } from "./low-latency-relay-client";

function signedMint(id: string, address: string, nonce: number, hashChar: string): BrowserSignedMint {
  const binding = `0x${"b".repeat(64)}`;
  const lowLatencyBinding = `0x${hashChar.repeat(64)}`;
  return {
    binding,
    lowLatencyBinding,
    expectedHash: `0x${hashChar.repeat(64)}`,
    signedAt: "2026-08-25T00:00:00.000Z",
    rawSignedTransaction: new BrowserRawSignedTransaction(`0x02${hashChar.repeat(140)}`, lowLatencyBinding),
    transaction: {
      id,
      binding,
      lowLatencyBinding,
      chain: { key: "robinhood", chainId: 4663, name: "Robinhood Chain", explorer: "https://explorer.example/tx/", nativeSymbol: "ETH", rpcUrl: "https://rpc.example", seaDropAddress: "0x000000000000000000000000000000000000dEaD", ready: true, warnings: [] },
      rpcUrl: "https://rpc.example",
      walletAlias: id,
      walletAddress: address,
      recipientMode: "holder",
      recipientAddress: "0x0000000000000000000000000000000000000001",
      stageId: "stage",
      stageLabel: "Public",
      quantity: 1,
      request: {
        to: "0x000000000000000000000000000000000000dEaD",
        data: "0x1234",
        value: BigInt(0),
        nonce,
        gasLimit: BigInt(21000),
        maxFeePerGas: BigInt(1),
        maxPriorityFeePerGas: BigInt(1),
      },
      status: "simulated",
    },
  };
}

type RelayCallBody = Record<string, unknown> & { expectedHashes?: string[]; transactions?: Array<{ expectedHash: string }> };

test("fireSignedMintsViaRelay issues a memory-only token, reveals raw tx only to relay, and preserves nonce order", async () => {
  const calls: Array<{ url: string; body: RelayCallBody; authorization?: string }> = [];
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = (init?.body ? JSON.parse(String(init.body)) : {}) as RelayCallBody;
    calls.push({ url: String(url), body, authorization: init?.headers instanceof Headers ? init.headers.get("authorization") ?? undefined : (init?.headers as Record<string, string> | undefined)?.authorization });
    if (String(url) === "/api/relay/token") {
      assert.deepEqual(body.expectedHashes, [`0x${"a".repeat(64)}`, `0x${"c".repeat(64)}`, `0x${"d".repeat(64)}`]);
      return Response.json({ ok: true, token: "relay-token", expiresAt: Date.now() + 60_000, storage: "memory-only; do not persist in browser storage" });
    }
    return Response.json({ ok: true, accepted: 1, results: [] });
  };

  const sameAddress = "0x00000000000000000000000000000000000000aa";
  const results = await fireSignedMintsViaRelay({
    relayUrl: "https://relay.example/",
    launchId: "compas-test",
    chainId: 4663,
    planBinding: `0x${"b".repeat(64)}`,
    concurrency: 3,
    fetchImpl,
    signedMints: [
      signedMint("later", sameAddress, 2, "a"),
      signedMint("other", "0x00000000000000000000000000000000000000bb", 0, "c"),
      signedMint("first", sameAddress, 1, "d"),
    ],
  });

  assert.equal(results.length, 3);
  assert.equal(results.every((result) => result.status === "fulfilled"), true);
  const relayCalls = calls.filter((call) => call.url === "https://relay.example/broadcast");
  assert.equal(relayCalls.length, 3);
  assert.equal(relayCalls.every((call) => call.authorization === "Bearer relay-token"), true);
  assert.deepEqual(relayCalls.map((call) => call.body.transactions?.[0]?.expectedHash), [`0x${"c".repeat(64)}`, `0x${"d".repeat(64)}`, `0x${"a".repeat(64)}`]);
  assert.equal(JSON.stringify(results).includes("02" + "a".repeat(32)), false);
});

test("fireSignedMintsViaRelay rejects non-memory token responses", async () => {
  await assert.rejects(() => fireSignedMintsViaRelay({
    relayUrl: "https://relay.example",
    launchId: "compas-test",
    chainId: 4663,
    planBinding: `0x${"b".repeat(64)}`,
    signedMints: [signedMint("one", "0x00000000000000000000000000000000000000aa", 1, "e")],
    fetchImpl: async () => Response.json({ ok: true, token: "relay-token", expiresAt: Date.now() + 60_000, storage: "localStorage" }),
  }), /memory-only/i);
});
