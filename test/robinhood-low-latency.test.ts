import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ROBINHOOD_CHAIN_ID,
  buildRobinhoodRouteHealthReport,
  maskEndpointUrl,
  resolveRobinhoodLowLatencyRoutes,
} from "../src/robinhood-low-latency";

const FLAGS = {
  LOW_LATENCY_BROADCAST: "true",
  MULTI_RPC: "true",
  ROBINHOOD_SEQUENCER: "true",
};

const ROUTES = {
  ROBINHOOD_SEQUENCER_RPC_URL: "https://sequencer.operator.invalid/rpc/seq-secret-key",
  ROBINHOOD_ALCHEMY_RPC_URL: "https://alchemy.operator.invalid/v2/alchemy-secret-key",
  ROBINHOOD_QUICKNODE_RPC_URL: "https://quicknode.operator.invalid/quicknode-secret-key/",
};

test("Robinhood low-latency routes are feature-flagged and resolved from env only", () => {
  const disabled = resolveRobinhoodLowLatencyRoutes({ ...ROUTES });
  assert.equal(disabled.status, "disabled");
  assert.deepEqual(disabled.routes, []);
  assert.match(disabled.blockers.join(" "), /LOW_LATENCY_BROADCAST/i);

  const ready = resolveRobinhoodLowLatencyRoutes({ ...FLAGS, ...ROUTES });
  assert.equal(ready.status, "ready");
  assert.equal(ready.chainId, ROBINHOOD_CHAIN_ID);
  assert.deepEqual(ready.routes.map((route) => route.id), [
    "robinhood-sequencer",
    "robinhood-alchemy",
    "robinhood-quicknode",
  ]);
  assert.deepEqual(ready.routes.map((route) => route.chainId), [4663, 4663, 4663]);
  assert.equal(ready.routes.every((route) => route.source === "env"), true);
});

test("Robinhood low-latency config fails closed when required endpoints or flags are missing", () => {
  const noMulti = resolveRobinhoodLowLatencyRoutes({
    LOW_LATENCY_BROADCAST: "true",
    ROBINHOOD_SEQUENCER: "true",
    ...ROUTES,
  });
  assert.equal(noMulti.status, "blocked");
  assert.deepEqual(noMulti.routes, []);
  assert.match(noMulti.blockers.join(" "), /MULTI_RPC/i);

  const missingEndpoint = resolveRobinhoodLowLatencyRoutes({
    ...FLAGS,
    ROBINHOOD_SEQUENCER_RPC_URL: ROUTES.ROBINHOOD_SEQUENCER_RPC_URL,
    ROBINHOOD_ALCHEMY_RPC_URL: ROUTES.ROBINHOOD_ALCHEMY_RPC_URL,
  });
  assert.equal(missingEndpoint.status, "blocked");
  assert.deepEqual(missingEndpoint.routes, []);
  assert.match(missingEndpoint.blockers.join(" "), /QuickNode/i);
});

test("Robinhood route config accepts explicit JSON config and rejects wrong chain IDs", () => {
  const resolved = resolveRobinhoodLowLatencyRoutes({
    LOW_LATENCY_BROADCAST: "1",
    MULTI_RPC: "1",
    ROBINHOOD_SEQUENCER: "0",
    ROBINHOOD_ALCHEMY_RPC_URL: ROUTES.ROBINHOOD_ALCHEMY_RPC_URL,
    ROBINHOOD_QUICKNODE_RPC_URL: ROUTES.ROBINHOOD_QUICKNODE_RPC_URL,
    ROBINHOOD_LOW_LATENCY_ROUTES_JSON: JSON.stringify({
      routes: [
        { id: "robinhood-custom", kind: "custom", chainId: 4663, url: "https://custom.operator.invalid/rpc/custom-key" },
        { id: "wrong-chain", kind: "custom", chainId: 8453, url: "https://base.operator.invalid/rpc/base-key" },
      ],
    }),
  });

  assert.equal(resolved.status, "ready");
  assert.deepEqual(resolved.routes.map((route) => route.id), ["robinhood-alchemy", "robinhood-quicknode", "robinhood-custom"]);
  assert.equal(resolved.routes.some((route) => route.id === "wrong-chain"), false);
});

test("health report returns endpoint health plus p50/p95 latency from samples without leaking keys", () => {
  const routes = resolveRobinhoodLowLatencyRoutes({ ...FLAGS, ...ROUTES }).routes;
  const report = buildRobinhoodRouteHealthReport(routes, [
    { routeId: "robinhood-sequencer", ok: true, latencyMs: 12, sampledAt: "2026-08-25T00:00:01.000Z" },
    { routeId: "robinhood-sequencer", ok: true, latencyMs: 20, sampledAt: "2026-08-25T00:00:02.000Z" },
    { routeId: "robinhood-sequencer", ok: true, latencyMs: 41, sampledAt: "2026-08-25T00:00:03.000Z" },
    { routeId: "robinhood-alchemy", ok: true, latencyMs: 30, sampledAt: "2026-08-25T00:00:01.000Z" },
    { routeId: "robinhood-alchemy", ok: false, latencyMs: 1000, sampledAt: "2026-08-25T00:00:02.000Z", error: "HTTP 429" },
    { routeId: "robinhood-quicknode", ok: false, latencyMs: 900, sampledAt: "2026-08-25T00:00:01.000Z", error: "timeout" },
  ], "2026-08-25T00:01:00.000Z");

  assert.equal(report.generatedAt, "2026-08-25T00:01:00.000Z");
  assert.equal(report.aggregate.configuredCount, 3);
  assert.equal(report.aggregate.healthyCount, 1);
  assert.equal(report.aggregate.degradedCount, 1);
  assert.equal(report.aggregate.downCount, 1);
  assert.equal(report.aggregate.ready, false);

  const sequencer = report.endpoints.find((endpoint) => endpoint.id === "robinhood-sequencer");
  assert.equal(sequencer?.status, "healthy");
  assert.equal(sequencer?.latencyMs.p50, 20);
  assert.equal(sequencer?.latencyMs.p95, 41);

  const alchemy = report.endpoints.find((endpoint) => endpoint.id === "robinhood-alchemy");
  assert.equal(alchemy?.status, "degraded");
  assert.equal(alchemy?.lastError, "HTTP 429");

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("alchemy-secret-key"), false);
  assert.equal(serialized.includes("quicknode-secret-key"), false);
  assert.equal(serialized.includes("seq-secret-key"), false);
});

test("route source contains no hardcoded Robinhood provider secrets or frontend-exposed RPC variables", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/robinhood-low-latency.ts"), "utf8");
  assert.doesNotMatch(source, /NEXT_PUBLIC_.*(?:RPC|ALCHEMY|QUICKNODE|SEQUENCER)/i);
  assert.doesNotMatch(source, /[A-Za-z0-9_-]{24,}\.(?:quiknode|quicknode)\.pro/i);
  assert.doesNotMatch(source, /g\.alchemy\.com\/v2\/[A-Za-z0-9_-]{16,}/i);
  assert.doesNotMatch(source, /chain\.robinhood\.com\/[^\s"'`]*[A-Za-z0-9_-]{20,}/i);
});

test("maskEndpointUrl redacts path tokens and credentials", () => {
  assert.equal(
    maskEndpointUrl("https://user:pass@example.invalid/v2/abcdefghijklmnopqrstuvwxyz123456"),
    "https://%E2%80%A6:%E2%80%A6@example.invalid/v2/abcd%E2%80%A63456",
  );
});
