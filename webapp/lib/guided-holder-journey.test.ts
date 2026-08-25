import assert from "node:assert/strict";
import test from "node:test";
import { Interface, id } from "ethers";

import {
  buildBrowserMintPlan,
  createSubmittedMintReceipt,
  pollPreparedBrowserMintReceipt,
  simulatePreparedBrowserMint,
  broadcastPreparedBrowserMint,
  type BrowserPreparedMint,
  type GuidedMintReceipt,
  type UnlockedLaunchVault,
} from "./browser-broadcast";
import {
  assessGuidedFinish,
  checkGuidedExecutionCapabilities,
  readGuidedBurnerBalances,
  resolveGuidedHolderStep,
} from "./guided-holder-flow";

const COLLECTION = "0x1111111111111111111111111111111111111111";
const FEE_RECIPIENT = "0x2222222222222222222222222222222222222222";
const HOLDER = "0x3333333333333333333333333333333333333333";
const BURNER = "0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A";
const TX_HASH = `0x${"a".repeat(64)}`;
const PRIVATE_KEY = `0x${"1".repeat(64)}`;
const MINT_IFACE = new Interface([
  "function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable",
]);

const vault: UnlockedLaunchVault = {
  status: "unlocked",
  unlockedAt: "2026-08-25T00:00:00.000Z",
  wallets: [{ alias: "Burner 1", address: BURNER, chain: "Base", privateKey: PRIVATE_KEY }],
};

function preparedMint(): BrowserPreparedMint {
  return buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [{
      id: "public",
      label: "Public",
      source: "onchain-seadrop",
      quantity: 1,
      priceEth: "0.05",
      feeRecipient: FEE_RECIPIENT,
    }],
    walletCount: 1,
    vault,
    recipientMode: "holder",
    holderRecipientAddress: HOLDER,
    maxTotalValueWei: BigInt("50000000000000000"),
  }).transactions[0];
}

async function submittedMint(): Promise<BrowserPreparedMint> {
  const simulated = await simulatePreparedBrowserMint(preparedMint(), {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    call: async () => "0x",
    estimateGas: async () => BigInt(120_000),
  });
  return broadcastPreparedBrowserMint(simulated, {
    explicitConsent: true,
    consentBinding: simulated.binding,
    provider: { getNetwork: async () => ({ chainId: BigInt(8453) }) },
    makeWallet: () => ({ sendTransaction: async () => ({ hash: TX_HASH }) }),
  });
}

function addressTopic(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

test("receipt lifecycle moves Submitted to Confirming without rebroadcasting", async () => {
  const tx = await submittedMint();
  const submitted = createSubmittedMintReceipt(tx);
  let receiptReads = 0;

  assert.equal(submitted.status, "Submitted");
  const confirming = await pollPreparedBrowserMintReceipt(tx, submitted, {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    getTransactionReceipt: async () => { receiptReads += 1; return null; },
    getBlockNumber: async () => 100,
    getBalance: async () => BigInt(0),
  });

  assert.equal(confirming.status, "Confirming");
  assert.equal(confirming.hash, TX_HASH);
  assert.equal(receiptReads, 1);
});

test("receipt verification confirms only after the collection transfers the NFT to the bound holder", async () => {
  const tx = await submittedMint();
  const confirming: GuidedMintReceipt = { ...createSubmittedMintReceipt(tx), status: "Confirming" };
  const receipt = await pollPreparedBrowserMintReceipt(tx, confirming, {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    getTransactionReceipt: async () => ({
      status: 1,
      blockNumber: 100,
      hash: TX_HASH,
      logs: [{
        address: COLLECTION,
        topics: [id("Transfer(address,address,uint256)"), addressTopic("0x0000000000000000000000000000000000000000"), addressTopic(HOLDER), `0x${"2a".padStart(64, "0")}`],
        data: "0x",
      }],
    }),
    getBlockNumber: async () => 101,
    getBalance: async () => BigInt(0),
  }, 2);

  assert.equal(receipt.status, "Confirmed");
  assert.equal(receipt.verifiedRecipient, HOLDER);
  assert.deepEqual(receipt.tokenIds, ["42"]);
  assert.equal(receipt.confirmations, 2);
});

test("successful receipts without the bound holder transfer fail closed", async () => {
  const tx = await submittedMint();
  const receipt = await pollPreparedBrowserMintReceipt(tx, createSubmittedMintReceipt(tx), {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    getTransactionReceipt: async () => ({ status: 1, blockNumber: 100, hash: TX_HASH, logs: [] }),
    getBlockNumber: async () => 100,
    getBalance: async () => BigInt(0),
  });

  assert.equal(receipt.status, "Failed");
  assert.match(receipt.error ?? "", /verified NFT transfer.*holder/i);
  assert.equal(receipt.verifiedRecipient, undefined);
});

test("receipt verification rejects an existing NFT transfer as mint evidence", async () => {
  const tx = await submittedMint();
  const receipt = await pollPreparedBrowserMintReceipt(tx, createSubmittedMintReceipt(tx), {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    getTransactionReceipt: async () => ({
      status: 1,
      blockNumber: 100,
      hash: TX_HASH,
      logs: [{
        address: COLLECTION,
        topics: [id("Transfer(address,address,uint256)"), addressTopic(BURNER), addressTopic(HOLDER), `0x${"2a".padStart(64, "0")}`],
        data: "0x",
      }],
    }),
    getBlockNumber: async () => 100,
    getBalance: async () => BigInt(0),
  });

  assert.equal(receipt.status, "Failed");
  assert.match(receipt.error ?? "", /verified NFT transfer.*holder/i);
});

test("funding capability check requires the same bound plan to provide drop, recipient, spend, signer, and receipt reads", async () => {
  const tx = preparedMint();
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [{ id: "public", label: "Public", source: "onchain-seadrop", quantity: 1, priceEth: "0.05", feeRecipient: FEE_RECIPIENT }],
    walletCount: 1,
    vault,
    recipientMode: "holder",
    holderRecipientAddress: HOLDER,
    maxTotalValueWei: BigInt("50000000000000000"),
  });
  assert.equal(MINT_IFACE.decodeFunctionData("mintPublic", tx.request.data)[0], COLLECTION);

  const ready = await checkGuidedExecutionCapabilities({
    plan,
    holderAddress: HOLDER,
    burnerAddresses: [BURNER],
    mintValueMaxWei: BigInt("50000000000000000"),
    provider: {
      getNetwork: async () => ({ chainId: BigInt(8453) }),
      getTransactionReceipt: async () => null,
      getBlockNumber: async () => 100,
      getBalance: async () => BigInt("60000000000000000"),
    },
  });

  assert.equal(ready.ready, true);
  assert.deepEqual(ready.checks.map((check) => check.id), ["drop", "recipient", "spend", "signers", "receipts"]);
  assert.equal(ready.planBinding, plan.binding);

  const blocked = await checkGuidedExecutionCapabilities({
    plan,
    holderAddress: HOLDER,
    burnerAddresses: [BURNER],
    mintValueMaxWei: BigInt("49999999999999999"),
    provider: {
      getNetwork: async () => ({ chainId: BigInt(8453) }),
      getTransactionReceipt: async () => { throw new Error("method unavailable"); },
      getBlockNumber: async () => 100,
      getBalance: async () => BigInt(0),
    },
  });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.checks.find((check) => check.id === "spend")?.ok, false);
  assert.equal(blocked.checks.find((check) => check.id === "receipts")?.ok, false);
});

test("guided resolver continues from simulation through mint, receipts, and finish", () => {
  const completeBeforeSimulation = { holder: true, burners: true, drop: true, fundingReview: true, fundingComplete: true };
  assert.equal(resolveGuidedHolderStep({ ...completeBeforeSimulation, simulationComplete: false, broadcastComplete: false, receiptsComplete: false }), "simulate");
  assert.equal(resolveGuidedHolderStep({ ...completeBeforeSimulation, simulationComplete: true, broadcastComplete: false, receiptsComplete: false }), "mint");
  assert.equal(resolveGuidedHolderStep({ ...completeBeforeSimulation, simulationComplete: true, broadcastComplete: true, receiptsComplete: false }), "receipts");
  assert.equal(resolveGuidedHolderStep({ ...completeBeforeSimulation, simulationComplete: true, broadcastComplete: true, receiptsComplete: true }), "finish");
});

test("finish is blocked for pending, failed, unknown, or nonzero burner balances and hands recovery to the holder", () => {
  const tx = { ...preparedMint(), status: "broadcast" as const, hash: TX_HASH };
  const confirmed: GuidedMintReceipt = {
    transactionId: tx.id,
    binding: tx.binding,
    hash: TX_HASH,
    status: "Confirmed",
    confirmations: 1,
    verifiedRecipient: HOLDER,
    tokenIds: ["42"],
  };

  const pending = assessGuidedFinish({ holderAddress: HOLDER, expectedTransactionCount: 1, transactions: [tx], receipts: [{ ...confirmed, status: "Confirming", verifiedRecipient: undefined, tokenIds: undefined }], burnerBalances: { [BURNER]: BigInt(0) } });
  assert.equal(pending.ready, false);
  assert.match(pending.blockers.join(" "), /receipt.*Confirming/i);

  const nonzero = assessGuidedFinish({ holderAddress: HOLDER, expectedTransactionCount: 1, transactions: [tx], receipts: [confirmed], burnerBalances: { [BURNER]: BigInt(1) } });
  assert.equal(nonzero.ready, false);
  assert.equal(nonzero.recovery.required, true);
  assert.equal(nonzero.recovery.mode, "manual-exact-sweep");
  assert.equal(nonzero.recovery.recipient, HOLDER);
  assert.deepEqual(nonzero.recovery.burners, [{ address: BURNER, balanceWei: BigInt(1), status: "nonzero" }]);
  assert.match(nonzero.recovery.instruction, /recover.*Vault/i);

  const unknown = assessGuidedFinish({ holderAddress: HOLDER, expectedTransactionCount: 1, transactions: [tx], receipts: [confirmed], burnerBalances: {} });
  assert.equal(unknown.ready, false);
  assert.equal(unknown.recovery.burners[0].status, "unknown");

  const safe = assessGuidedFinish({ holderAddress: HOLDER, expectedTransactionCount: 1, transactions: [tx], receipts: [confirmed], burnerBalances: { [BURNER]: BigInt(0) } });
  assert.equal(safe.ready, true);
  assert.deepEqual(safe.blockers, []);
});

test("transient receipt RPC errors remain recoverable and can be polled again", async () => {
  const tx = await submittedMint();
  const submitted = createSubmittedMintReceipt(tx);
  const unavailable = await pollPreparedBrowserMintReceipt(tx, submitted, {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    getTransactionReceipt: async () => { throw new Error("temporary gateway timeout"); },
    getBlockNumber: async () => 100,
    getBalance: async () => BigInt(0),
  });
  assert.equal(unavailable.status, "Unknown");
  assert.match(unavailable.error ?? "", /temporary gateway timeout/i);

  const confirming = await pollPreparedBrowserMintReceipt(tx, unavailable, {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    getTransactionReceipt: async () => null,
    getBlockNumber: async () => 100,
    getBalance: async () => BigInt(0),
  });
  assert.equal(confirming.status, "Confirming");
  assert.equal(confirming.error, undefined);
});

test("receipt chain mismatch remains recoverable instead of permanently failing a submitted hash", async () => {
  const tx = await submittedMint();
  const result = await pollPreparedBrowserMintReceipt(tx, createSubmittedMintReceipt(tx), {
    getNetwork: async () => ({ chainId: BigInt(1) }),
    getTransactionReceipt: async () => null,
    getBlockNumber: async () => 100,
    getBalance: async () => BigInt(0),
  });
  assert.equal(result.status, "Unknown");
  assert.match(result.error ?? "", /chain ID 1.*expected 8453/i);
});

test("malformed receipt status remains recoverable while an explicit onchain revert is final", async () => {
  const tx = await submittedMint();
  const providerBase = {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    getBlockNumber: async () => 100,
    getBalance: async () => BigInt(0),
  };
  const malformed = await pollPreparedBrowserMintReceipt(tx, createSubmittedMintReceipt(tx), {
    ...providerBase,
    getTransactionReceipt: async () => ({ status: "pending", blockNumber: 100, hash: TX_HASH, logs: [] }),
  });
  assert.equal(malformed.status, "Unknown");

  const reverted = await pollPreparedBrowserMintReceipt(tx, createSubmittedMintReceipt(tx), {
    ...providerBase,
    getTransactionReceipt: async () => ({ status: "0x0", blockNumber: 100, hash: TX_HASH, logs: [] }),
  });
  assert.equal(reverted.status, "Failed");
  assert.match(reverted.error ?? "", /reverted/i);
});

test("finish fails closed for empty or incomplete runs and requires the expected transaction count", () => {
  const empty = assessGuidedFinish({ holderAddress: HOLDER, expectedTransactionCount: 1, transactions: [], receipts: [], burnerBalances: {} });
  assert.equal(empty.ready, false);
  assert.match(empty.blockers.join(" "), /expected 1.*found 0/i);

  const tx = { ...preparedMint(), status: "broadcast" as const, hash: TX_HASH };
  const incomplete = assessGuidedFinish({ holderAddress: HOLDER, expectedTransactionCount: 2, transactions: [tx], receipts: [], burnerBalances: { [BURNER]: BigInt(0) } });
  assert.equal(incomplete.ready, false);
  assert.match(incomplete.blockers.join(" "), /expected 2.*found 1/i);

  const mismatchedHash = assessGuidedFinish({
    holderAddress: HOLDER,
    expectedTransactionCount: 1,
    transactions: [tx],
    receipts: [{ transactionId: tx.id, binding: tx.binding, hash: `0x${"b".repeat(64)}`, status: "Confirmed", confirmations: 1, verifiedRecipient: HOLDER, tokenIds: ["42"] }],
    burnerBalances: { [BURNER]: BigInt(0) },
  });
  assert.equal(mismatchedHash.ready, false);
  assert.match(mismatchedHash.blockers.join(" "), /hash/i);
});

test("receipt malformed block numbers stay retryable and local tracker mismatches become terminal evidence", async () => {
  const tx = await submittedMint();
  const providerBase = {
    getNetwork: async () => ({ chainId: BigInt(8453) }),
    getBlockNumber: async () => 100,
    getBalance: async () => BigInt(0),
  };
  const malformedBlock = await pollPreparedBrowserMintReceipt(tx, createSubmittedMintReceipt(tx), {
    ...providerBase,
    getTransactionReceipt: async () => ({
      status: 1,
      blockNumber: Number.NaN,
      hash: TX_HASH,
      logs: [{
        address: COLLECTION,
        topics: [id("Transfer(address,address,uint256)"), addressTopic("0x0000000000000000000000000000000000000000"), addressTopic(HOLDER), `0x${"2a".padStart(64, "0")}`],
        data: "0x",
      }],
    }),
  });
  assert.equal(malformedBlock.status, "Unknown");
  assert.match(malformedBlock.error ?? "", /block/i);

  const malformedLatestBlock = await pollPreparedBrowserMintReceipt(tx, createSubmittedMintReceipt(tx), {
    ...providerBase,
    getBlockNumber: async () => Number.NaN,
    getTransactionReceipt: async () => ({
      status: 1,
      blockNumber: 100,
      hash: TX_HASH,
      logs: [{
        address: COLLECTION,
        topics: [id("Transfer(address,address,uint256)"), addressTopic("0x0000000000000000000000000000000000000000"), addressTopic(HOLDER), `0x${"2a".padStart(64, "0")}`],
        data: "0x",
      }],
    }),
  });
  assert.equal(malformedLatestBlock.status, "Unknown");
  assert.match(malformedLatestBlock.error ?? "", /latest block/i);
  assert.equal(Number.isFinite(malformedLatestBlock.confirmations), true);

  const mismatchedTracker = await pollPreparedBrowserMintReceipt(tx, { ...createSubmittedMintReceipt(tx), hash: `0x${"b".repeat(64)}` }, {
    ...providerBase,
    getTransactionReceipt: async () => null,
  });
  assert.equal(mismatchedTracker.status, "Failed");
  assert.match(mismatchedTracker.error ?? "", /tracker.*exact submitted mint plan/i);
});

test("burner balance reads validate the exact plan chain before reading any address", async () => {
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [{ id: "public", label: "Public", source: "onchain-seadrop", quantity: 1, priceEth: "0.05", feeRecipient: FEE_RECIPIENT }],
    walletCount: 1,
    vault,
    recipientMode: "holder",
    holderRecipientAddress: HOLDER,
    maxTotalValueWei: BigInt("50000000000000000"),
  });
  let balanceReads = 0;
  await assert.rejects(() => readGuidedBurnerBalances(plan, {
    getNetwork: async () => ({ chainId: BigInt(1) }),
    getTransactionReceipt: async () => null,
    getBlockNumber: async () => 100,
    getBalance: async () => { balanceReads += 1; return BigInt(0); },
  }), /chain 1.*8453/i);
  assert.equal(balanceReads, 0);
});
