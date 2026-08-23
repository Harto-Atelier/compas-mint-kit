import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBrowserGasStrategy,
  buildBrowserMintPlan,
  buildBrowserRunReport,
  broadcastPreparedBrowserMint,
  browserChainConfig,
  explorerTxUrl,
  simulatePreparedBrowserMint,
  type BrowserMintStageInput,
  type UnlockedLaunchVault,
} from "./browser-broadcast";

const COLLECTION = "0x1111111111111111111111111111111111111111";
const FEE_RECIPIENT = "0x2222222222222222222222222222222222222222";
const PRIVATE_KEY = `0x${"1".repeat(64)}`;

const publicStage: BrowserMintStageInput = {
  id: "public",
  label: "PUBLIC STAGE",
  source: "onchain-seadrop",
  quantity: 2,
  priceEth: "0.025",
  feeRecipient: FEE_RECIPIENT,
};

const unlockedVault: UnlockedLaunchVault = {
  status: "unlocked",
  unlockedAt: "2026-08-22T00:00:00.000Z",
  wallets: [
    {
      alias: "mint-ops",
      address: "0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A",
      chain: "Base",
      privateKey: PRIVATE_KEY,
    },
  ],
};

test("browser mint plan requires an unlocked in-memory vault and executable SeaDrop public stage", () => {
  assert.throws(
    () => buildBrowserMintPlan({
      chainKey: "base",
      collectionAddress: COLLECTION,
      stages: [publicStage],
      walletCount: 1,
      vault: null,
    }),
    /unlock the encrypted launch vault/i,
  );

  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
  });

  assert.equal(plan.chain.key, "base");
  assert.equal(plan.rpcUrl, "https://mainnet.base.org");
  assert.equal(plan.transactions.length, 1);
  assert.equal(plan.transactions[0].status, "prepared");
  assert.equal(plan.transactions[0].request.to, "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5");
  assert.equal(plan.transactions[0].request.value, BigInt("50000000000000000"));
  assert.match(plan.transactions[0].request.data, /^0x/);
  assert.equal(JSON.stringify(plan).includes(PRIVATE_KEY.slice(2)), false, "plan serialization must not expose private keys");
});

test("robinhood browser plan is gated on operator RPC and SeaDrop singleton", () => {
  const base = browserChainConfig({ chainKey: "base" });
  assert.equal(base.ready, true);
  assert.equal(base.rpcUrl, "https://mainnet.base.org");

  const robinhoodMissing = browserChainConfig({ chainKey: "robinhood" });
  assert.equal(robinhoodMissing.ready, false);
  assert.match(robinhoodMissing.warnings.join(" "), /operator RPC URL/i);
  assert.match(robinhoodMissing.warnings.join(" "), /SeaDrop/i);

  const robinhoodReady = browserChainConfig({
    chainKey: "robinhood",
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    seaDropAddress: "0x3333333333333333333333333333333333333333",
  });
  assert.equal(robinhoodReady.ready, true);
  assert.equal(robinhoodReady.seaDropAddress, "0x3333333333333333333333333333333333333333");
});

test("broadcast is impossible until simulation succeeds and explicit consent is supplied", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
  });
  const tx = plan.transactions[0];

  await assert.rejects(
    () => broadcastPreparedBrowserMint(tx, {
      explicitConsent: true,
      makeWallet: () => ({
        sendTransaction: async () => ({ hash: `0x${"a".repeat(64)}` }),
      }),
    }),
    /simulate before broadcast/i,
  );

  const simulated = await simulatePreparedBrowserMint(tx, {
    call: async () => "0x",
    estimateGas: async () => BigInt(123456),
  });

  await assert.rejects(
    () => broadcastPreparedBrowserMint(simulated, {
      explicitConsent: false,
      makeWallet: () => ({
        sendTransaction: async () => ({ hash: `0x${"a".repeat(64)}` }),
      }),
    }),
    /explicit broadcast confirmation/i,
  );

  const broadcasted = await broadcastPreparedBrowserMint(simulated, {
    explicitConsent: true,
    makeWallet: () => ({
      sendTransaction: async () => ({ hash: `0x${"a".repeat(64)}` }),
    }),
  });

  assert.equal(broadcasted.status, "broadcast");
  assert.equal(broadcasted.hash, `0x${"a".repeat(64)}`);
  assert.equal(broadcasted.explorerUrl, explorerTxUrl("base", broadcasted.hash!));
});

test("browser run report summarizes tx hashes, gas, failures, and strips private keys", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
  });
  const simulated = await simulatePreparedBrowserMint(plan.transactions[0], {
    call: async () => "0x",
    estimateGas: async () => BigInt(123456),
  });
  const broadcasted = await broadcastPreparedBrowserMint(simulated, {
    explicitConsent: true,
    makeWallet: () => ({ sendTransaction: async () => ({ hash: `0x${"b".repeat(64)}` }) }),
  });
  const failed = { ...broadcasted, id: "failed-row", status: "failed" as const, hash: undefined, explorerUrl: undefined, error: `bad key ${PRIVATE_KEY}` };

  const report = buildBrowserRunReport({
    collection: { address: COLLECTION, name: "Canary Drop" },
    chain: plan.chain,
    transactions: [broadcasted, failed],
    generatedAt: "2026-08-23T00:00:00.000Z",
  });

  assert.equal(report.summary.total, 2);
  assert.equal(report.summary.broadcast, 1);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.transactions[0].txHash, `0x${"b".repeat(64)}`);
  assert.equal(report.transactions[0].gasEstimate, "123456");
  assert.equal(JSON.stringify(report).includes(PRIVATE_KEY.slice(2)), false);
  assert.equal(report.transactions[1].error, "bad key [redacted-hex]");
});


test("browser gas strategy clamps attempts and warns on risky nonce/retry settings", () => {
  const plan = buildBrowserGasStrategy({
    maxFeeGwei: 0.08,
    priorityFeeGwei: 0.02,
    retryLimit: 4,
    escalationPercent: 15,
    nonceMode: "parallel",
  });

  assert.equal(plan.attempts.length, 5);
  assert.deepEqual(plan.attempts[0], { attempt: 1, maxFeeGwei: "0.08", priorityFeeGwei: "0.02" });
  assert.equal(plan.attempts[4].maxFeeGwei, "0.128");
  assert.match(plan.warnings.join(" "), /Parallel nonce mode/i);
  assert.match(plan.warnings.join(" "), /More than 3 retries/i);
});
