import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExecutionPlan,
  buildDryRunExecutionReport,
  createNoopBroadcaster,
  type ExecutionSchedulerInput,
} from "../src/execution-scheduler";

const robinhoodInput: ExecutionSchedulerInput = {
  mode: "dry-run",
  chain: {
    key: "robinhood",
    name: "Robinhood Chain",
    chainId: 4663,
    nativeSymbol: "ETH",
  },
  wallets: [
    { alias: "hot", envVar: "RH_HOT_KEY", address: "0x0000000000000000000000000000000000000001" },
    { alias: "backup", envVar: "RH_BACKUP_KEY", address: "0x0000000000000000000000000000000000000002" },
    { alias: "third", envVar: "RH_THIRD_ADDRESS", address: "0x0000000000000000000000000000000000000003" },
  ],
  transaction: {
    to: "0x000000000000000000000000000000000000c0Fe",
    data: "0x12345678",
    valueWei: 25_000_000_000_000_000n,
    gasLimit: 250_000,
    maxFeePerGasWei: 2_000_000_000n,
    maxPriorityFeePerGasWei: 50_000_000n,
  },
  rpc: {
    queryEndpoint: "https://robinhood-mainnet.g.alchemy.com/v2/super-secret-key",
    broadcastEndpoints: [
      "https://robinhood-mainnet.g.alchemy.com/v2/super-secret-key",
      "https://rpc.mainnet.chain.robinhood.com",
      "https://sequencer.mainnet.chain.robinhood.com",
    ],
  },
  nonce: {
    strategy: "provided-pending",
    startingNonces: {
      "0x0000000000000000000000000000000000000001": 11,
      "0x0000000000000000000000000000000000000002": 22,
      "0x0000000000000000000000000000000000000003": 33,
    },
  },
  rateLimit: {
    maxConcurrent: 2,
    minDelayBetweenSubmissionsMs: 125,
    batchCooldownMs: 500,
  },
  retry: {
    maxAttempts: 3,
    baseDelayMs: 250,
    multiplier: 2,
    retryableErrors: ["timeout", "rate limit", "nonce too low"],
  },
};

test("buildExecutionPlan assigns wallet nonces, concurrency batches, retry windows and masked Robinhood RPCs", () => {
  const plan = buildExecutionPlan(robinhoodInput);

  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.broadcastEnabled, false);
  assert.equal(plan.chain.key, "robinhood");
  assert.equal(plan.totals.wallets, 3);
  assert.equal(plan.totals.transactions, 3);
  assert.equal(plan.concurrency.width, 2);
  assert.deepEqual(plan.concurrency.batches.map((batch) => batch.map((item) => item.alias)), [["hot", "backup"], ["third"]]);

  assert.deepEqual(plan.tasks.map((task) => ({ alias: task.alias, nonce: task.nonce, batch: task.batchIndex, slot: task.slotIndex, offset: task.scheduledOffsetMs })), [
    { alias: "hot", nonce: 11, batch: 0, slot: 0, offset: 0 },
    { alias: "backup", nonce: 22, batch: 0, slot: 1, offset: 125 },
    { alias: "third", nonce: 33, batch: 1, slot: 0, offset: 750 },
  ]);

  assert.equal(plan.rpc.queryEndpoint.label, "ALCHEMY");
  assert.equal(plan.rpc.queryEndpoint.maskedUrl.includes("super-secret-key"), false);
  assert.deepEqual(plan.rpc.broadcastEndpoints.map((endpoint) => endpoint.label), ["ALCHEMY", "robinhood-public", "robinhood-sequencer"]);
  assert.equal(plan.retry.maxAttempts, 3);
  assert.deepEqual(plan.tasks[0].retryScheduleMs, [0, 250, 500]);
});

test("buildExecutionPlan supports Ethereum and fails closed when a nonce is missing", () => {
  const input: ExecutionSchedulerInput = {
    ...robinhoodInput,
    chain: { key: "ethereum", name: "Ethereum", chainId: 1, nativeSymbol: "ETH" },
    wallets: [{ alias: "eth-hot", envVar: "ETH_HOT_KEY", address: "0x00000000000000000000000000000000000000e1" }],
    rpc: {
      queryEndpoint: "https://eth-mainnet.g.alchemy.com/v2/mainnet-key",
      broadcastEndpoints: ["https://eth-mainnet.g.alchemy.com/v2/mainnet-key", "https://ethereum-rpc.publicnode.com"],
    },
    nonce: { strategy: "provided-pending", startingNonces: { "0x00000000000000000000000000000000000000e1": 7 } },
  };

  assert.equal(buildExecutionPlan(input).tasks[0].nonce, 7);

  assert.throws(
    () => buildExecutionPlan({ ...input, nonce: { strategy: "provided-pending", startingNonces: {} } }),
    /missing pending nonce for wallet eth-hot/i
  );
});

test("dry-run report never invokes the broadcaster interface", async () => {
  const broadcaster = createNoopBroadcaster(async () => {
    throw new Error("broadcast should not be called by dry-run reports");
  });
  const plan = buildExecutionPlan(robinhoodInput);
  const report = await buildDryRunExecutionReport(plan, { broadcaster });

  assert.equal(report.mode, "dry-run");
  assert.equal(report.broadcastInvoked, false);
  assert.match(report.safetySummary, /no transaction was signed or broadcast/i);
  assert.equal(JSON.stringify(report).includes("super-secret-key"), false);
});
