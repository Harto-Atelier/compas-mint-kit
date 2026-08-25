import assert from "node:assert/strict";
import test from "node:test";

import {
  GUIDED_HOLDER_RECOVERY_STORAGE_KEY,
  buildGuidedHolderRecoveryJournal,
  parseGuidedHolderRecoveryJournal,
  rehydrateGuidedRecoveryBalancePlan,
  rehydrateGuidedRecoveryTransactions,
} from "./guided-holder-recovery";
import { buildBrowserMintPlan, type UnlockedLaunchVault } from "./browser-broadcast";

const PRIVATE_KEY = `0x${"1".repeat(64)}`;
const HOLDER = "0x3333333333333333333333333333333333333333";
const COLLECTION = "0x1111111111111111111111111111111111111111";
const BURNER = "0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A";
const HASH = `0x${"a".repeat(64)}`;
const vault: UnlockedLaunchVault = {
  status: "unlocked",
  unlockedAt: "2026-08-25T00:00:00.000Z",
  wallets: [{ alias: "Burner 1", address: BURNER, chain: "Base", privateKey: PRIVATE_KEY }],
};

function plan() {
  return buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [{ id: "public", label: "Public", source: "onchain-seadrop", quantity: 1, priceEth: "0.05", feeRecipient: "0x2222222222222222222222222222222222222222" }],
    walletCount: 1,
    vault,
    recipientMode: "holder",
    holderRecipientAddress: HOLDER,
    maxTotalValueWei: BigInt("50000000000000000"),
    gasLimit: BigInt(250_000),
    maxFeePerGasWei: BigInt(80_000_000),
  });
}

test("recovery journal persists only secret-free bound evidence needed after refresh", () => {
  const mintPlan = plan();
  const submitted = { ...mintPlan.transactions[0], status: "broadcast" as const, hash: HASH, explorerUrl: `${mintPlan.chain.explorer}/tx/${HASH}`, broadcastAttempted: true };
  const journal = buildGuidedHolderRecoveryJournal({
    plan: mintPlan,
    collection: { address: COLLECTION, name: "Guided drop" },
    recipient: HOLDER,
    transactions: [submitted],
    receipts: [{ transactionId: submitted.id, binding: submitted.binding, hash: HASH, status: "Unknown", confirmations: 0, error: "Requires reconciliation." }],
    fundingSubmissions: [{ transactionId: "fund-burner-1", hash: `0x${"b".repeat(64)}` }],
    updatedAt: "2026-08-25T00:00:00.000Z",
  });
  const serialized = JSON.stringify(journal);

  assert.equal(GUIDED_HOLDER_RECOVERY_STORAGE_KEY, "compas-guided-holder-recovery-v1");
  assert.equal(serialized.includes(PRIVATE_KEY.slice(2)), false);
  assert.equal(/rawSigned|signedTransaction|privateKey/i.test(serialized), false);
  assert.equal(journal.planBinding, mintPlan.binding);
  assert.deepEqual(journal.burnerAddresses, [BURNER]);
  assert.equal(journal.fundingTransactions[0].hash, `0x${"b".repeat(64)}`);
  assert.equal(journal.mintTransactions[0].hash, HASH);

  const restored = parseGuidedHolderRecoveryJournal(serialized);
  const transactions = rehydrateGuidedRecoveryTransactions(restored);
  assert.equal(transactions[0].hash, HASH);
  assert.equal(transactions[0].request.value, BigInt("50000000000000000"));
  const balancePlan = rehydrateGuidedRecoveryBalancePlan(restored);
  assert.equal(balancePlan.chain.chainId, 8453);
  assert.deepEqual(balancePlan.transactions.map((transaction) => transaction.walletAddress), [BURNER]);
  assert.equal(JSON.stringify(restored).includes(PRIVATE_KEY.slice(2)), false);
});

test("recovery journal rejects secret-shaped or binding-inconsistent persisted records", () => {
  const mintPlan = plan();
  const submitted = { ...mintPlan.transactions[0], status: "broadcast" as const, hash: HASH, broadcastAttempted: true };
  const journal = buildGuidedHolderRecoveryJournal({
    plan: mintPlan,
    collection: { address: COLLECTION, name: "Guided drop" },
    recipient: HOLDER,
    transactions: [submitted],
    receipts: [],
    fundingSubmissions: [],
  });
  assert.throws(() => parseGuidedHolderRecoveryJournal(JSON.stringify({ ...journal, privateKey: PRIVATE_KEY })), /forbidden secret/i);
  assert.throws(() => parseGuidedHolderRecoveryJournal(JSON.stringify({
    ...journal,
    mintTransactions: [{ ...journal.mintTransactions[0], walletAlias: PRIVATE_KEY }],
  })), /secret-shaped value/i);
  assert.throws(() => parseGuidedHolderRecoveryJournal(JSON.stringify({
    ...journal,
    collection: { ...journal.collection, name: `backup ${PRIVATE_KEY}` },
  })), /secret-shaped value/i);
  assert.throws(() => parseGuidedHolderRecoveryJournal(JSON.stringify({
    ...journal,
    receipts: [{ transactionId: journal.mintTransactions[0].id, binding: journal.planBinding, hash: HASH, status: "Unknown", confirmations: 0, error: `rpc leaked ${PRIVATE_KEY}` }],
  })), /secret-shaped value/i);
  assert.throws(() => parseGuidedHolderRecoveryJournal(JSON.stringify({ ...journal, mintTransactions: [{ ...journal.mintTransactions[0], binding: "wrong" }] })), /binding/i);
});
