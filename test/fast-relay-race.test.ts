import assert from "node:assert/strict";
import test from "node:test";
import { keccak256 } from "ethers";

import {
  relaySameHashToRpcs,
  type FastRelayFetch,
  type FastRelayRpcEndpoint,
} from "../src/fast-relay";

const RAW_TX = "0x1234";
const EXPECTED_HASH = keccak256(RAW_TX);

function endpoints(labels: string[]): FastRelayRpcEndpoint[] {
  return labels.map((label) => ({ url: `https://${label}.example/rpc`, label }));
}

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? "Too Many Requests" : "OK",
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function fakeFetchByLabel(routes: Record<string, Response | Error>): FastRelayFetch {
  return async (url) => {
    const label = new URL(String(url)).hostname.split(".")[0];
    const route = routes[label];
    if (route instanceof Error) throw route;
    if (!route) throw new Error(`missing fake route for ${label}`);
    return route;
  };
}

test("fast relay accepts when any RPC returns the expected same transaction hash", async () => {
  const bodies: string[] = [];
  const result = await relaySameHashToRpcs(RAW_TX, endpoints(["slow", "winner", "reject"]), {
    fetch: async (url, init) => {
      bodies.push(String(init?.body));
      return fakeFetchByLabel({
        slow: jsonResponse({ error: { code: -32000, message: "replacement transaction underpriced" } }),
        winner: jsonResponse({ jsonrpc: "2.0", id: 1, result: EXPECTED_HASH }),
        reject: jsonResponse({ error: { code: -32000, message: "insufficient funds for gas * price + value" } }),
      })(url, init);
    },
  });

  assert.equal(result.expectedTxHash, EXPECTED_HASH);
  assert.equal(result.state, "ACCEPTED");
  assert.equal(result.acceptedBy.map((route) => route.label).join(","), "winner");
  assert.equal(result.routes.find((route) => route.label === "winner")?.outcome, "ACCEPTED");
  assert.deepEqual(bodies, [
    JSON.stringify({ jsonrpc: "2.0", method: "eth_sendRawTransaction", params: [RAW_TX], id: 1 }),
    JSON.stringify({ jsonrpc: "2.0", method: "eth_sendRawTransaction", params: [RAW_TX], id: 1 }),
    JSON.stringify({ jsonrpc: "2.0", method: "eth_sendRawTransaction", params: [RAW_TX], id: 1 }),
  ]);
});

test("fast relay treats already-known for the same raw transaction as accepted, not failed", async () => {
  const result = await relaySameHashToRpcs(RAW_TX, endpoints(["known", "reject"]), {
    fetch: fakeFetchByLabel({
      known: jsonResponse({ error: { code: -32000, message: "already known" } }),
      reject: jsonResponse({ error: { code: -32000, message: "execution reverted" } }),
    }),
  });

  assert.equal(result.state, "ACCEPTED");
  assert.equal(result.acceptedBy.map((route) => route.label).join(","), "known");
  assert.equal(result.routes.find((route) => route.label === "known")?.outcome, "ALREADY_KNOWN");
  assert.equal(result.routes.find((route) => route.label === "known")?.definiteAcceptance, true);
  assert.equal(result.routes.some((route) => String(route.outcome) === "FAILED"), false);
});

test("fast relay is ambiguous when definitive rejection is mixed with a timeout", async () => {
  const result = await relaySameHashToRpcs(RAW_TX, endpoints(["reject", "timeout"]), {
    fetch: fakeFetchByLabel({
      reject: jsonResponse({ error: { code: -32000, message: "invalid sender" } }),
      timeout: new DOMException("signal timed out", "TimeoutError"),
    }),
  });

  assert.equal(result.state, "AMBIGUOUS");
  assert.equal(result.routes.find((route) => route.label === "timeout")?.outcome, "TIMEOUT");
});

test("fast relay rejects only when every RPC gives a definitive rejection", async () => {
  const result = await relaySameHashToRpcs(RAW_TX, endpoints(["badnonce", "badfunds"]), {
    fetch: fakeFetchByLabel({
      badnonce: jsonResponse({ error: { code: -32000, message: "nonce too low" } }),
      badfunds: jsonResponse({ error: { code: -32000, message: "insufficient funds" } }),
    }),
  });

  assert.equal(result.state, "REJECTED");
  assert.deepEqual(result.rejectedBy.map((route) => route.label), ["badnonce", "badfunds"]);
});

test("fast relay marks malformed RPC bodies ambiguous instead of pretending the tx failed", async () => {
  const result = await relaySameHashToRpcs(RAW_TX, endpoints(["malformed"]), {
    fetch: fakeFetchByLabel({ malformed: jsonResponse({ jsonrpc: "2.0", id: 1 }) }),
  });

  assert.equal(result.state, "AMBIGUOUS");
  assert.equal(result.routes[0].outcome, "MALFORMED");
});

test("fast relay treats HTTP 429 rate limits as ambiguous unless another RPC accepted", async () => {
  const result = await relaySameHashToRpcs(RAW_TX, endpoints(["limited", "winner"]), {
    fetch: fakeFetchByLabel({
      limited: jsonResponse({ error: { message: "rate limited" } }, 429),
      winner: jsonResponse({ result: EXPECTED_HASH }),
    }),
  });

  assert.equal(result.state, "ACCEPTED");
  assert.equal(result.routes.find((route) => route.label === "limited")?.outcome, "RATE_LIMITED");

  const allLimited = await relaySameHashToRpcs(RAW_TX, endpoints(["limited"]), {
    fetch: fakeFetchByLabel({ limited: jsonResponse({ error: { message: "Too Many Requests" } }, 429) }),
  });
  assert.equal(allLimited.state, "AMBIGUOUS");
});
