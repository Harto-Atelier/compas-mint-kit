import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyGuidedRelayFireError,
  classifyGuidedRelayFireResult,
  decideGuidedFastPathAction,
  describeGuidedFastPathTiming,
  formatGuidedFastPathTiming,
  guidedFastPathLaunchId,
  isAlreadyKnownBroadcastError,
  resolveGuidedRelayUrl,
  shouldUseGuidedFastPath,
} from "./guided-fast-path";

test("fast path is only chosen when a relay URL is configured and health shows working routes", () => {
  const url = "https://compas-fast-relay-production.up.railway.app";
  assert.equal(shouldUseGuidedFastPath({ relayUrl: url, health: "active" }), true);
  assert.equal(shouldUseGuidedFastPath({ relayUrl: url, health: "degraded" }), true);
  assert.equal(shouldUseGuidedFastPath({ relayUrl: url, health: "unavailable" }), false);
  assert.equal(shouldUseGuidedFastPath({ relayUrl: url, health: "loading" }), false);
  assert.equal(shouldUseGuidedFastPath({ relayUrl: null, health: "active" }), false);
});

test("relay URL resolution normalizes trailing slashes and rejects non-HTTP values", () => {
  assert.equal(resolveGuidedRelayUrl("https://relay.example//"), "https://relay.example");
  assert.equal(resolveGuidedRelayUrl(" https://relay.example "), "https://relay.example");
  assert.equal(resolveGuidedRelayUrl(""), null);
  assert.equal(resolveGuidedRelayUrl(undefined), null);
  assert.equal(resolveGuidedRelayUrl("relay.example"), null);
  assert.equal(resolveGuidedRelayUrl("ftp://relay.example"), null);
});

test("fire result classification maps relay outcomes conservatively", () => {
  assert.equal(classifyGuidedRelayFireResult({ status: "fulfilled", value: { relayStatus: "ACCEPTED" } }), "accepted");
  assert.equal(classifyGuidedRelayFireResult({ status: "fulfilled", value: { relayStatus: "AMBIGUOUS" } }), "ambiguous");
  assert.equal(classifyGuidedRelayFireResult({ status: "rejected", reason: new Error("Relay rejected 0xabc: HTTP 400") }), "rejected");
  assert.equal(classifyGuidedRelayFireResult({ status: "rejected", reason: new Error("fetch failed") }), "network-failed");
  assert.equal(classifyGuidedRelayFireResult(undefined), "network-failed");
});

test("fire error classification separates token issuance failures from transport failures", () => {
  assert.equal(classifyGuidedRelayFireError(new Error("Failed to issue relay auth token.")), "token-failed");
  assert.equal(classifyGuidedRelayFireError(new Error("Relay token response must declare memory-only storage.")), "token-failed");
  assert.equal(classifyGuidedRelayFireError(new Error("Relay rejected 0xdef: HTTP 401")), "rejected");
  assert.equal(classifyGuidedRelayFireError(new Error("network timeout")), "network-failed");
  assert.equal(classifyGuidedRelayFireError("socket hang up"), "network-failed");
  assert.equal(classifyGuidedRelayFireError(undefined), "network-failed");
});

test("rows without signed bytes always fall back to the direct RPC broadcast path", () => {
  for (const outcome of ["token-failed", "network-failed", "rejected", "ambiguous"] as const) {
    assert.equal(decideGuidedFastPathAction({ outcome, hasSignedBytes: false }), "fallback-direct");
  }
});

test("signed rows are terminal: accepted confirms fast, everything else rebroadcasts the same bytes", () => {
  assert.equal(decideGuidedFastPathAction({ outcome: "accepted", hasSignedBytes: true }), "confirm-fast");
  for (const outcome of ["ambiguous", "token-failed", "network-failed", "rejected"] as const) {
    assert.equal(decideGuidedFastPathAction({ outcome, hasSignedBytes: true }), "rebroadcast-same-bytes");
  }
});

test("already-known broadcast errors count as definite acceptance of the same bytes", () => {
  assert.equal(isAlreadyKnownBroadcastError(new Error("already known")), true);
  assert.equal(isAlreadyKnownBroadcastError(new Error("Known transaction: 0xdead")), true);
  assert.equal(isAlreadyKnownBroadcastError(new Error("transaction already in mempool")), true);
  assert.equal(isAlreadyKnownBroadcastError(new Error("ALREADY_EXISTS: tx already exists in cache")), true);
  assert.equal(isAlreadyKnownBroadcastError(new Error("nonce too low")), false);
  assert.equal(isAlreadyKnownBroadcastError(new Error("insufficient funds")), false);
  assert.equal(isAlreadyKnownBroadcastError(undefined), false);
});

test("launch id derivation stays a canonical ASCII slug within relay token limits", () => {
  const derived = guidedFastPathLaunchId("0xABCDEF0123456789abcdef0123456789ABCDEF01");
  assert.equal(derived, "compas-guided-0xabcdef0123456789abcdef0123456789abcdef01");
  assert.equal(derived.length <= 72, true);
  assert.match(derived, /^[a-z0-9](?:[a-z0-9-]{0,70}[a-z0-9])?$/);
  assert.equal(guidedFastPathLaunchId(undefined), "compas-guided-mint");
  assert.equal(guidedFastPathLaunchId("not-an-address"), "compas-guided-mint");
});

test("timing formatting is compact, secret-free, and absent without a measured send", () => {
  assert.equal(formatGuidedFastPathTiming({ route: "fast", signMs: 12.4, sendMs: 311.6 }), "⚡ 312 ms");
  assert.equal(formatGuidedFastPathTiming({ route: "direct", sendMs: 0.2 }), "⚡ 1 ms");
  assert.equal(formatGuidedFastPathTiming({ route: "fast" }), null);
  assert.equal(formatGuidedFastPathTiming(null), null);
  assert.equal(formatGuidedFastPathTiming({ route: "fast", sendMs: Number.NaN }), null);
  assert.equal(describeGuidedFastPathTiming({ route: "fast", signMs: 8, sendMs: 120 }), "Firma 8 ms · Envío 120 ms · Vía rápida");
  assert.equal(describeGuidedFastPathTiming({ route: "direct", sendMs: 950 }), "Envío 950 ms · Vía directa");
  assert.equal(describeGuidedFastPathTiming(null), null);
});
