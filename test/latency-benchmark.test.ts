import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateLatencyStats,
  parseBenchmarkConfig,
  redactBenchmarkValue,
  summarizeEndpointMeasurements,
} from "../src/latency-benchmark";

test("calculateLatencyStats reports percentiles min max jitter error percent and 429 percent", () => {
  const stats = calculateLatencyStats([
    { totalMs: 10, statusCode: 200 },
    { totalMs: 20, statusCode: 200 },
    { totalMs: 30, statusCode: 429 },
    { totalMs: 40, error: "timeout" },
  ]);

  assert.equal(stats.samples, 4);
  assert.equal(stats.successes, 3);
  assert.equal(stats.errors, 1);
  assert.equal(stats.rateLimited, 1);
  assert.equal(stats.errorPct, 25);
  assert.equal(stats.rateLimitedPct, 25);
  assert.equal(stats.minMs, 10);
  assert.equal(stats.maxMs, 30);
  assert.equal(stats.p50Ms, 20);
  assert.equal(stats.p90Ms, 30);
  assert.equal(stats.p95Ms, 30);
  assert.equal(stats.p99Ms, 30);
  assert.equal(stats.jitterMs, 8.16);
});

test("summarizeEndpointMeasurements includes measurable phase percentiles", () => {
  const summary = summarizeEndpointMeasurements("robinhood-public", [
    {
      totalMs: 50,
      dnsMs: 2,
      tcpMs: 8,
      tlsMs: 12,
      requestMs: 3,
      responseMs: 25,
      statusCode: 200,
    },
    {
      totalMs: 100,
      dnsMs: 4,
      tcpMs: 10,
      tlsMs: 20,
      requestMs: 6,
      responseMs: 60,
      statusCode: 200,
    },
  ]);

  assert.equal(summary.label, "robinhood-public");
  assert.equal(summary.total.p50Ms, 50);
  assert.equal(summary.phases.dns.p95Ms, 4);
  assert.equal(summary.phases.tcp.maxMs, 10);
  assert.equal(summary.phases.tls.p90Ms, 20);
  assert.equal(summary.phases.request.minMs, 3);
  assert.equal(summary.phases.response.maxMs, 60);
});

test("redactBenchmarkValue strips url credentials api keys jwt tokens raw txs and private keys", () => {
  const secretUrl = "https://user:pass@rpc.example.com/v2/super-secret-key?apiKey=abc123&token=def456";
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature";
  const rawTx = "0x02" + "a".repeat(200);
  const key = "0x" + "b".repeat(64);
  const redacted = redactBenchmarkValue(`${secretUrl} bearer=${jwt} tx=${rawTx} key=${key}`);

  assert.equal(redacted.includes("user:pass"), false);
  assert.equal(redacted.includes("super-secret-key"), false);
  assert.equal(redacted.includes("abc123"), false);
  assert.equal(redacted.includes("def456"), false);
  assert.equal(redacted.includes(jwt), false);
  assert.equal(redacted.includes(rawTx), false);
  assert.equal(redacted.includes(key.slice(2)), false);
  assert.match(redacted, /\[redacted-url-secret\]/);
  assert.match(redacted, /apiKey=\[redacted\]/);
  assert.match(redacted, /token=\[redacted\]/);
  assert.match(redacted, /\[redacted-jwt\]/);
  assert.match(redacted, /\[redacted-raw-transaction\]/);
  assert.match(redacted, /\[redacted-64-hex\]/);
});

test("parseBenchmarkConfig keeps provider and region labels while redacting display urls", () => {
  const config = parseBenchmarkConfig({
    sampleCount: 7,
    warmupCount: 2,
    providers: [
      {
        label: "rh-us-east",
        provider: "Robinhood",
        region: "us-east",
        url: "https://user:pass@rpc.mainnet.chain.robinhood.com/v2/secret",
      },
    ],
    websocketFeeds: [
      { label: "sequencer-feed", provider: "Robinhood", region: "us-east", url: "wss://feed.example.com/secret" },
    ],
  });

  assert.equal(config.sampleCount, 7);
  assert.equal(config.warmupCount, 2);
  assert.equal(config.providers[0].label, "rh-us-east");
  assert.equal(config.providers[0].provider, "Robinhood");
  assert.equal(config.providers[0].region, "us-east");
  assert.equal(config.providers[0].displayUrl.includes("/secret"), false);
  assert.equal(config.providers[0].displayUrl.includes("user:pass"), false);
  assert.equal(config.websocketFeeds[0].status, "placeholder");
  assert.equal(config.websocketFeeds[0].health, "not-measured");
});
