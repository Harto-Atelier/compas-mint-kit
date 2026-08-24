import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBrowserGasStrategy,
  buildBrowserMintPlan,
  buildBrowserRunReport,
  type BrowserMintStageInput,
  type BrowserRunReport,
  type UnlockedLaunchVault,
} from "./browser-broadcast";
import {
  extractCostBasisFromBrowserReport,
  rejectSecretShapedReport,
  roundEth,
  summarizeCostBasis,
  type CostBasisEntry,
} from "./cost-basis";

const COLLECTION = "0x1111111111111111111111111111111111111111";
const FEE_RECIPIENT = "0x2222222222222222222222222222222222222222";
const HOLDER_RECIPIENT = "0x3333333333333333333333333333333333333333";
const WALLET_ONE = "0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A";
const WALLET_TWO = "0x1563915e194D8CfBA1943570603F7606A3115508";
const PRIVATE_KEY = `0x${"1".repeat(64)}`;

const publicStage: BrowserMintStageInput = {
  id: "public",
  label: "Public",
  source: "onchain-seadrop",
  quantity: 2,
  priceEth: "0.025",
  feeRecipient: FEE_RECIPIENT,
};

const tinyStage: BrowserMintStageInput = {
  id: "tiny",
  label: "Tiny rounding",
  source: "onchain-seadrop",
  quantity: 1,
  priceEth: "0.0000004",
  feeRecipient: FEE_RECIPIENT,
};

const unlockedVault: UnlockedLaunchVault = {
  status: "unlocked",
  unlockedAt: "2026-08-24T00:00:00.000Z",
  wallets: [
    { alias: "mint-ops-1", address: WALLET_ONE, chain: "Base", privateKey: PRIVATE_KEY },
    { alias: "mint-ops-2", address: WALLET_TWO, chain: "Base", privateKey: `0x${"2".repeat(64)}` },
  ],
};

function buildFixtureReport(): BrowserRunReport {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 2,
    vault: unlockedVault,
    recipientMode: "holder",
    holderRecipientAddress: HOLDER_RECIPIENT,
  });

  const [first, second] = plan.transactions;
  const broadcasted = {
    ...first,
    status: "broadcast" as const,
    simulationGas: "21000",
    hash: `0x${"a".repeat(64)}`,
  };
  const failed = {
    ...second,
    id: "failed-row",
    status: "failed" as const,
    simulationGas: "21000",
    hash: undefined,
  };
  const prepared = { ...second, id: "prepared-row", status: "prepared" as const, simulationGas: undefined, hash: undefined };

  return buildBrowserRunReport({
    collection: { address: COLLECTION, name: "Canary Drop" },
    chain: plan.chain,
    transactions: [broadcasted, failed, prepared],
    gasStrategy: buildBrowserGasStrategy({ maxFeeGwei: 2, priorityFeeGwei: 0.5, retryLimit: 0, escalationPercent: 0, nonceMode: "sequential" }),
    generatedAt: "2026-08-24T00:00:00.000Z",
  });
}

test("extractCostBasisFromBrowserReport derives value, gas, and cost basis from broadcast browser rows", () => {
  const entries = extractCostBasisFromBrowserReport(buildFixtureReport());

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    walletAddress: WALLET_ONE,
    recipientAddress: HOLDER_RECIPIENT,
    collectionAddress: COLLECTION,
    chain: "base",
    txHash: `0x${"a".repeat(64)}`,
    valueEth: 0.05,
    estimatedGasEth: 0.000042,
    costBasisEth: 0.050042,
    status: "broadcast",
  } satisfies CostBasisEntry);
});

test("extractCostBasisFromBrowserReport excludes failed, prepared, and simulated rows", () => {
  const report = buildFixtureReport();

  assert.equal(report.summary.total, 3);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.prepared, 1);
  assert.equal(extractCostBasisFromBrowserReport(report).length, 1);
});

test("extractCostBasisFromBrowserReport does not invent gas when fee strategy is unknown", () => {
  const report = buildFixtureReport();
  const noGasStrategy: BrowserRunReport = { ...report, gasStrategy: undefined };

  assert.deepEqual(extractCostBasisFromBrowserReport(noGasStrategy).map((entry) => [entry.estimatedGasEth, entry.costBasisEth]), [[null, 0.05]]);
});

test("summarizeCostBasis totals by payer wallet and recipient with 6-decimal rounding", () => {
  const entries: CostBasisEntry[] = [
    ...extractCostBasisFromBrowserReport(buildFixtureReport()),
    {
      walletAddress: WALLET_TWO,
      recipientAddress: HOLDER_RECIPIENT,
      collectionAddress: COLLECTION,
      chain: "base",
      valueEth: 0.1000004,
      estimatedGasEth: 0.0000004,
      costBasisEth: roundEth(0.1000008),
      status: "confirmed",
    },
  ];

  assert.deepEqual(summarizeCostBasis(entries), {
    totalSpentEth: 0.150043,
    perWallet: {
      [WALLET_ONE]: 0.050042,
      [WALLET_TWO]: 0.100001,
    },
    perRecipient: {
      [HOLDER_RECIPIENT]: 0.150043,
    },
    count: 2,
  });
});

test("rounding follows kit convention", () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [tinyStage],
    walletCount: 1,
    vault: unlockedVault,
  });
  const report = buildBrowserRunReport({
    collection: { address: COLLECTION, name: "Tiny" },
    chain: plan.chain,
    transactions: [{ ...plan.transactions[0], status: "broadcast", hash: `0x${"b".repeat(64)}` }],
    generatedAt: "2026-08-24T00:00:00.000Z",
  });

  assert.equal(extractCostBasisFromBrowserReport(report)[0].valueEth, 0);
  assert.equal(roundEth(0.1234567), 0.123457);
});

test("rejectSecretShapedReport throws for secret field names and private-key-shaped values", () => {
  assert.throws(() => rejectSecretShapedReport(JSON.stringify({ privateKey: PRIVATE_KEY })), /secret-shaped field/i);
  assert.throws(() => rejectSecretShapedReport(JSON.stringify({ note: "key material " + "3".repeat(64) })), /64-hex/i);
  assert.doesNotThrow(() => rejectSecretShapedReport(JSON.stringify({ txHash: `0x${"c".repeat(64)}`, blockHash: `0x${"d".repeat(64)}` })));
});
