import { Interface } from "ethers";
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBrowserGasStrategy,
  buildBrowserMintPlan,
  buildBrowserRunReport,
  broadcastPreparedBrowserMint,
  browserChainConfig,
  explorerTxUrl,
  invalidateBrowserMintTransactions,
  isTerminalBrowserMint,
  revokePreparedBrowserMintSigners,
  reviewPreparedBrowserMintCalldata,
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
    recipientMode: "payer",
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

test("plan binding changes for every execution-defining input", () => {
  const secondVault: UnlockedLaunchVault = {
    ...unlockedVault,
    wallets: [
      ...unlockedVault.wallets,
      {
        alias: "mint-ops-2",
        address: "0x1563915e194D8CfBA1943570603F7606A3115508",
        chain: "Base",
        privateKey: `0x${"2".repeat(64)}`,
      },
    ],
  };
  const baseInput = {
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: secondVault,
    recipientMode: "payer" as const,
  };
  const original = buildBrowserMintPlan(baseInput).binding;
  const changedBindings = [
    buildBrowserMintPlan({ ...baseInput, chainKey: "ethereum" }).binding,
    buildBrowserMintPlan({ ...baseInput, rpcUrl: "https://example.test/rpc" }).binding,
    buildBrowserMintPlan({ ...baseInput, seaDropAddress: "0x4444444444444444444444444444444444444444" }).binding,
    buildBrowserMintPlan({ ...baseInput, recipientMode: "custom", customRecipientAddress: "0x4444444444444444444444444444444444444444" }).binding,
    buildBrowserMintPlan({ ...baseInput, stages: [{ ...publicStage, quantity: 1 }] }).binding,
    buildBrowserMintPlan({ ...baseInput, collectionAddress: "0x4444444444444444444444444444444444444444" }).binding,
    buildBrowserMintPlan({ ...baseInput, walletCount: 2 }).binding,
  ];

  for (const changed of changedBindings) assert.notEqual(changed, original);
  assert.equal(original.includes(PRIVATE_KEY.slice(2)), false);
});

test("browser mint plan enforces an aggregate transaction-value cap", () => {
  assert.throws(
    () => buildBrowserMintPlan({
      chainKey: "base",
      collectionAddress: COLLECTION,
      stages: [publicStage],
      walletCount: 1,
      vault: unlockedVault,
      recipientMode: "payer",
      maxTotalEth: 0.049,
    }),
    /aggregate mint value 0\.05 ETH exceeds.*0\.049 ETH/i,
  );

  const capped = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
    maxTotalEth: 0.05,
  });
  assert.equal(capped.totalValueWei, BigInt("50000000000000000"));
  assert.equal(capped.maxTotalWei, BigInt("50000000000000000"));
});

test("browser mint plan requires an explicit recipient mode instead of defaulting to payer", () => {
  assert.throws(
    () => buildBrowserMintPlan({
      chainKey: "base",
      collectionAddress: COLLECTION,
      stages: [publicStage],
      walletCount: 1,
      vault: unlockedVault,
    }),
    /recipient mode.*required/i,
  );
});

test("browser mint plan accepts an exact wei cap without decimal conversion", () => {
  assert.throws(
    () => buildBrowserMintPlan({
      chainKey: "base",
      collectionAddress: COLLECTION,
      stages: [publicStage],
      walletCount: 1,
      vault: unlockedVault,
      recipientMode: "payer",
      maxTotalValueWei: BigInt("49999999999999999"),
    }),
    /aggregate mint value 0\.05 ETH exceeds/i,
  );

  const capped = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
    maxTotalValueWei: BigInt("50000000000000000"),
  });
  assert.equal(capped.maxTotalWei, BigInt("50000000000000000"));
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
    recipientMode: "payer",
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
    getNetwork: async () => ({ chainId: BigInt(8453) }),
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
    consentBinding: simulated.binding,
    provider: { getNetwork: async () => ({ chainId: BigInt(8453) }) },
    makeWallet: () => ({
      sendTransaction: async () => ({ hash: `0x${"a".repeat(64)}` }),
    }),
  });

  assert.equal(broadcasted.status, "broadcast");
  assert.equal(broadcasted.hash, `0x${"a".repeat(64)}`);
  assert.equal(broadcasted.explorerUrl, explorerTxUrl("base", broadcasted.hash!));
});

test("dropping unlocked keys revokes every prepared signer reference", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
  });
  const simulated = await simulatePreparedBrowserMint(plan.transactions[0], {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    call: async () => "0x",
    estimateGas: async () => BigInt(123456),
  });

  revokePreparedBrowserMintSigners([plan.transactions[0], simulated]);

  await assert.rejects(
    () => broadcastPreparedBrowserMint(simulated, {
      explicitConsent: true,
      makeWallet: () => ({ sendTransaction: async () => ({ hash: `0x${"a".repeat(64)}` }) }),
    }),
    /private key is no longer available/i,
  );
});

test("execution-input invalidation revokes stale signers while preserving terminal rows", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
  });
  const simulated = await simulatePreparedBrowserMint(plan.transactions[0], {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    call: async () => "0x",
    estimateGas: async () => BigInt(123456),
  });
  const terminal = { ...simulated, id: "terminal-row", status: "broadcast" as const, hash: `0x${"a".repeat(64)}` };

  const retained = invalidateBrowserMintTransactions([simulated, terminal]);

  assert.deepEqual(retained, [terminal]);
  await assert.rejects(
    () => broadcastPreparedBrowserMint(simulated, {
      explicitConsent: true,
      consentBinding: simulated.binding,
      provider: { getNetwork: async () => ({ chainId: BigInt(8453) }) },
      makeWallet: () => ({ sendTransaction: async () => ({ hash: `0x${"b".repeat(64)}` }) }),
    }),
    /private key is no longer available/i,
  );
});

test("broadcast rows are terminal and simulation never calls the RPC again", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
  });
  const terminal = { ...plan.transactions[0], status: "broadcast" as const, hash: `0x${"a".repeat(64)}` };
  let rpcCalls = 0;

  const result = await simulatePreparedBrowserMint(terminal, {
    getNetwork: async () => { rpcCalls += 1; return { chainId: BigInt(8453) }; },
    call: async () => { rpcCalls += 1; return "0x"; },
    estimateGas: async () => { rpcCalls += 1; return BigInt(123456); },
  });

  assert.equal(result, terminal);
  assert.equal(rpcCalls, 0);
});

test("a successful broadcast consumes signer authority and cannot be replayed", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
  });
  const simulated = await simulatePreparedBrowserMint(plan.transactions[0], {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    call: async () => "0x",
    estimateGas: async () => BigInt(123456),
  });
  const broadcasted = await broadcastPreparedBrowserMint(simulated, {
    explicitConsent: true,
    consentBinding: simulated.binding,
    provider: { getNetwork: async () => ({ chainId: BigInt(8453) }) },
    makeWallet: () => ({ sendTransaction: async () => ({ hash: `0x${"a".repeat(64)}` }) }),
  });
  broadcasted.status = "simulated";

  await assert.rejects(
    () => broadcastPreparedBrowserMint(broadcasted, {
      explicitConsent: true,
      consentBinding: broadcasted.binding,
      provider: { getNetwork: async () => ({ chainId: BigInt(8453) }) },
      makeWallet: () => ({ sendTransaction: async () => ({ hash: `0x${"b".repeat(64)}` }) }),
    }),
    /private key is no longer available/i,
  );
});

test("a failed broadcast attempt is terminal, revokes signer authority, and is retained for reporting", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
  });
  const simulated = await simulatePreparedBrowserMint(plan.transactions[0], {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    call: async () => "0x",
    estimateGas: async () => BigInt(123456),
  });
  let sendCalls = 0;
  const failed = await broadcastPreparedBrowserMint(simulated, {
    explicitConsent: true,
    consentBinding: simulated.binding,
    provider: { getNetwork: async () => ({ chainId: BigInt(8453) }) },
    makeWallet: () => ({ sendTransaction: async () => { sendCalls += 1; throw new Error("ambiguous RPC send failure"); } }),
  });

  assert.equal(failed.status, "failed");
  assert.equal(isTerminalBrowserMint(failed), true);
  assert.deepEqual(invalidateBrowserMintTransactions([failed]), [failed]);
  failed.status = "simulated";
  await assert.rejects(
    () => broadcastPreparedBrowserMint(failed, {
      explicitConsent: true,
      consentBinding: failed.binding,
      provider: { getNetwork: async () => ({ chainId: BigInt(8453) }) },
      makeWallet: () => ({ sendTransaction: async () => { sendCalls += 1; return { hash: `0x${"b".repeat(64)}` }; } }),
    }),
    /private key is no longer available/i,
  );
  assert.equal(sendCalls, 1);
});

test("simulation fails closed when the RPC reports a different chain id", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
  });
  let simulated = false;

  const result = await simulatePreparedBrowserMint(plan.transactions[0], {
    getNetwork: async () => ({ chainId: BigInt(1) }),
    call: async () => { simulated = true; return "0x"; },
    estimateGas: async () => BigInt(123456),
  });

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /RPC chain ID 1.*expected 8453/i);
  assert.equal(simulated, false);
});

test("browser run report summarizes tx hashes, gas, failures, and strips private keys", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
  });
  const simulated = await simulatePreparedBrowserMint(plan.transactions[0], {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    call: async () => "0x",
    estimateGas: async () => BigInt(123456),
  });
  const broadcasted = await broadcastPreparedBrowserMint(simulated, {
    explicitConsent: true,
    consentBinding: simulated.binding,
    provider: { getNetwork: async () => ({ chainId: BigInt(8453) }) },
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

test("browser reports redact arbitrarily long signed and raw transaction hex", () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
  });
  const rawTransaction = `0x${"ab".repeat(300)}`;
  const failed = { ...plan.transactions[0], status: "failed" as const, error: `RPC rejected signedTransaction=${rawTransaction}` };
  const report = buildBrowserRunReport({ collection: { address: COLLECTION }, chain: plan.chain, transactions: [failed] });

  assert.equal(report.transactions[0].error, "RPC rejected signedTransaction=[redacted-hex]");
  assert.equal(JSON.stringify(report).includes(rawTransaction), false);
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

const seaDropIface = new Interface(["function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable"]);

test("recipient routing can mint directly to verified Compas holder while payer remains burner", () => {
  const holderRecipient = "0x3333333333333333333333333333333333333333";
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "holder",
    holderRecipientAddress: holderRecipient,
  });
  const tx = plan.transactions[0];
  const decoded = seaDropIface.decodeFunctionData("mintPublic", tx.request.data);

  assert.equal(tx.walletAddress, unlockedVault.wallets[0].address);
  assert.equal(tx.recipientMode, "holder");
  assert.equal(tx.recipientAddress, holderRecipient);
  assert.equal(decoded[2], holderRecipient);
  assert.notEqual(tx.walletAddress.toLowerCase(), holderRecipient.toLowerCase());

  const report = buildBrowserRunReport({ collection: { address: COLLECTION, name: "Holder Routed" }, chain: plan.chain, transactions: [tx] });
  assert.equal(report.transactions[0].recipientMode, "holder");
  assert.equal(report.transactions[0].recipientAddress, holderRecipient);
});

test("holder recipient routing fails closed without a verified holder address", () => {
  assert.throws(
    () => buildBrowserMintPlan({
      chainKey: "base",
      collectionAddress: COLLECTION,
      stages: [publicStage],
      walletCount: 1,
      vault: unlockedVault,
      recipientMode: "holder",
    }),
    /verify a Compas holder wallet/i,
  );
});

test("pre-broadcast calldata review decodes SeaDrop mintPublic and blocks unsimulated txs", async () => {
  const holderRecipient = "0x3333333333333333333333333333333333333333";
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "holder",
    holderRecipientAddress: holderRecipient,
  });
  const preparedReview = reviewPreparedBrowserMintCalldata(plan.transactions[0], { collectionAddress: COLLECTION, holderRecipientAddress: holderRecipient, maxQuantity: 2 });
  assert.equal(preparedReview.functionName, "mintPublic");
  assert.equal(preparedReview.readyForBroadcast, false);
  assert.equal(preparedReview.checks.find((check) => check.id === "status")?.ok, false);

  const simulated = await simulatePreparedBrowserMint(plan.transactions[0], { getNetwork: async () => ({ chainId: BigInt(8453) }), call: async () => "0x", estimateGas: async () => BigInt(123456) });
  const simulatedReview = reviewPreparedBrowserMintCalldata(simulated, { collectionAddress: COLLECTION, holderRecipientAddress: holderRecipient, maxQuantity: 2 });
  assert.equal(simulatedReview.readyForBroadcast, true);
  assert.equal(simulatedReview.minterIfNotPayer, holderRecipient);
});

test("pre-broadcast review binds SeaDrop target, fee recipient, and exact transaction value", async () => {
  async function simulatedMint() {
    const plan = buildBrowserMintPlan({
      chainKey: "base",
      collectionAddress: COLLECTION,
      stages: [publicStage],
      walletCount: 1,
      vault: unlockedVault,
      recipientMode: "payer",
    });
    return simulatePreparedBrowserMint(plan.transactions[0], {
      getNetwork: async () => ({ chainId: BigInt(8453) }),
      call: async () => "0x",
      estimateGas: async () => BigInt(123456),
    });
  }

  const wrongTarget = await simulatedMint();
  wrongTarget.request.to = "0x4444444444444444444444444444444444444444";
  const targetReview = reviewPreparedBrowserMintCalldata(wrongTarget);
  assert.equal(targetReview.checks.find((check) => check.id === "target")?.ok, false);

  const wrongFee = await simulatedMint();
  wrongFee.request.data = seaDropIface.encodeFunctionData("mintPublic", [COLLECTION, "0x4444444444444444444444444444444444444444", "0x0000000000000000000000000000000000000000", BigInt(2)]);
  const feeReview = reviewPreparedBrowserMintCalldata(wrongFee);
  assert.equal(feeReview.checks.find((check) => check.id === "fee-recipient")?.ok, false);

  const wrongValue = await simulatedMint();
  wrongValue.request.value += BigInt(1);
  const valueReview = reviewPreparedBrowserMintCalldata(wrongValue);
  assert.equal(valueReview.checks.find((check) => check.id === "value")?.ok, false);
});

test("broadcast revalidates the bound request before invoking the wallet signer", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
  });
  const simulated = await simulatePreparedBrowserMint(plan.transactions[0], {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    call: async () => "0x",
    estimateGas: async () => BigInt(123456),
  });
  simulated.request.value += BigInt(1);
  let signerCalls = 0;

  await assert.rejects(
    () => broadcastPreparedBrowserMint(simulated, {
      explicitConsent: true,
      consentBinding: simulated.binding,
      provider: { getNetwork: async () => ({ chainId: BigInt(8453) }) },
      makeWallet: () => ({ sendTransaction: async () => { signerCalls += 1; return { hash: `0x${"a".repeat(64)}` }; } }),
    }),
    /request no longer matches/i,
  );
  assert.equal(signerCalls, 0);
});

test("broadcast consent is valid only for the exact simulated plan binding", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
  });
  const simulated = await simulatePreparedBrowserMint(plan.transactions[0], {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    call: async () => "0x",
    estimateGas: async () => BigInt(123456),
  });

  await assert.rejects(
    () => broadcastPreparedBrowserMint(simulated, {
      explicitConsent: true,
      consentBinding: `${plan.binding}-changed`,
      provider: { getNetwork: async () => ({ chainId: BigInt(8453) }) },
      makeWallet: () => ({ sendTransaction: async () => ({ hash: `0x${"a".repeat(64)}` }) }),
    }),
    /confirmation.*current transaction plan/i,
  );
});

test("broadcast rechecks the live RPC chain id immediately before signing", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [publicStage],
    walletCount: 1,
    vault: unlockedVault,
    recipientMode: "payer",
  });
  const simulated = await simulatePreparedBrowserMint(plan.transactions[0], {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    call: async () => "0x",
    estimateGas: async () => BigInt(123456),
  });
  let signerCalls = 0;

  await assert.rejects(
    () => broadcastPreparedBrowserMint(simulated, {
      explicitConsent: true,
      consentBinding: simulated.binding,
      provider: { getNetwork: async () => ({ chainId: BigInt(1) }) },
      makeWallet: () => ({ sendTransaction: async () => { signerCalls += 1; return { hash: `0x${"a".repeat(64)}` }; } }),
    }),
    /RPC chain ID 1.*expected 8453/i,
  );
  assert.equal(signerCalls, 0);
});
