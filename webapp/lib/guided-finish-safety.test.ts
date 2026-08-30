import assert from "node:assert/strict";
import test from "node:test";

import { buildBrowserMintPlan, type BrowserReceiptProviderLike, type GuidedMintReceipt, type UnlockedLaunchVault } from "./browser-broadcast";
import { confirmGuidedFinishResidualSafety } from "./guided-finish-safety";

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

function fakeProvider(input: {
  chainId?: bigint;
  balances?: Record<string, bigint>;
  failBalanceFor?: string[];
}): BrowserReceiptProviderLike {
  return {
    async getNetwork() {
      return { chainId: input.chainId ?? BigInt(8453) };
    },
    async getBlockNumber() {
      return 100;
    },
    async getTransactionReceipt() {
      return null;
    },
    async getBalance(address: string) {
      if (input.failBalanceFor?.some((candidate) => candidate.toLowerCase() === address.toLowerCase())) {
        throw new Error("balance read unavailable");
      }
      return input.balances?.[address.toLowerCase()] ?? BigInt(0);
    },
  };
}

function boundRun() {
  const mintPlan = plan();
  const submitted = {
    ...mintPlan.transactions[0],
    status: "broadcast" as const,
    hash: HASH,
    broadcastAttempted: true,
  };
  const confirmed: GuidedMintReceipt = {
    transactionId: submitted.id,
    binding: submitted.binding,
    hash: HASH,
    status: "Confirmed",
    confirmations: 3,
    verifiedRecipient: HOLDER,
    tokenIds: ["7"],
  };
  return { mintPlan, submitted, confirmed };
}

test("finish safety passes only when fresh chain-bound burner balances are exactly zero", async () => {
  const { mintPlan, submitted, confirmed } = boundRun();
  const result = await confirmGuidedFinishResidualSafety({
    holderAddress: HOLDER,
    expectedTransactionCount: 1,
    plan: mintPlan,
    transactions: [submitted],
    receipts: [confirmed],
    provider: fakeProvider({ balances: { [BURNER.toLowerCase()]: BigInt(0) } }),
    now: () => "2026-08-30T00:00:00.000Z",
  });
  assert.equal(result.safe, true);
  assert.equal(result.rpcError, null);
  assert.equal(result.assessment.ready, true);
  assert.equal(result.assessment.recovery.required, false);
  assert.equal(result.balances[BURNER.toLowerCase()], BigInt(0));
  assert.equal(result.checkedAt, "2026-08-30T00:00:00.000Z");
});

test("finish safety blocks finish on residual burner balance and routes into manual exact sweep recovery", async () => {
  const { mintPlan, submitted, confirmed } = boundRun();
  const residual = BigInt("12345000000000000");
  const result = await confirmGuidedFinishResidualSafety({
    holderAddress: HOLDER,
    expectedTransactionCount: 1,
    plan: mintPlan,
    transactions: [submitted],
    receipts: [confirmed],
    provider: fakeProvider({ balances: { [BURNER.toLowerCase()]: residual } }),
  });
  assert.equal(result.safe, false);
  assert.equal(result.assessment.ready, false);
  assert.equal(result.assessment.recovery.required, true);
  assert.equal(result.assessment.recovery.mode, "manual-exact-sweep");
  assert.equal(result.assessment.recovery.recipient, HOLDER);
  assert.equal(result.assessment.recovery.burners[0].status, "nonzero");
  assert.equal(result.assessment.recovery.burners[0].balanceWei, residual);
  assert.ok(result.assessment.blockers.some((blocker) => blocker.includes("still holds")));
});

test("finish safety ignores stale zero balances: the fresh read is authoritative", async () => {
  const { mintPlan, submitted, confirmed } = boundRun();
  // A prior UI state may claim zero. The gate re-reads onchain and finds funds.
  const result = await confirmGuidedFinishResidualSafety({
    holderAddress: HOLDER,
    expectedTransactionCount: 1,
    plan: mintPlan,
    transactions: [submitted],
    receipts: [confirmed],
    provider: fakeProvider({ balances: { [BURNER.toLowerCase()]: BigInt(1) } }),
  });
  assert.equal(result.safe, false);
  assert.equal(result.assessment.recovery.required, true);
});

test("finish safety fails closed on a wrong-chain RPC: every burner becomes unknown and finish stays blocked", async () => {
  const { mintPlan, submitted, confirmed } = boundRun();
  const result = await confirmGuidedFinishResidualSafety({
    holderAddress: HOLDER,
    expectedTransactionCount: 1,
    plan: mintPlan,
    transactions: [submitted],
    receipts: [confirmed],
    provider: fakeProvider({ chainId: BigInt(1), balances: { [BURNER.toLowerCase()]: BigInt(0) } }),
  });
  assert.equal(result.safe, false);
  assert.notEqual(result.rpcError, null);
  assert.equal(result.balances[BURNER.toLowerCase()], null);
  assert.equal(result.assessment.ready, false);
  assert.equal(result.assessment.recovery.required, true);
  assert.equal(result.assessment.recovery.burners[0].status, "unknown");
});

test("finish safety treats a failed balance read as unknown and blocks finish", async () => {
  const { mintPlan, submitted, confirmed } = boundRun();
  const result = await confirmGuidedFinishResidualSafety({
    holderAddress: HOLDER,
    expectedTransactionCount: 1,
    plan: mintPlan,
    transactions: [submitted],
    receipts: [confirmed],
    provider: fakeProvider({ failBalanceFor: [BURNER] }),
  });
  assert.equal(result.safe, false);
  assert.equal(result.balances[BURNER.toLowerCase()], null);
  assert.equal(result.assessment.recovery.burners[0].status, "unknown");
  assert.ok(result.assessment.blockers.some((blocker) => blocker.includes("unknown")));
});

test("finish safety still blocks zero-balance runs whose receipts are not confirmed to the holder", async () => {
  const { mintPlan, submitted } = boundRun();
  const pending: GuidedMintReceipt = {
    transactionId: submitted.id,
    binding: submitted.binding,
    hash: HASH,
    status: "Confirming",
    confirmations: 0,
  };
  const result = await confirmGuidedFinishResidualSafety({
    holderAddress: HOLDER,
    expectedTransactionCount: 1,
    plan: mintPlan,
    transactions: [submitted],
    receipts: [pending],
    provider: fakeProvider({ balances: { [BURNER.toLowerCase()]: BigInt(0) } }),
  });
  assert.equal(result.safe, false);
  assert.ok(result.assessment.blockers.some((blocker) => blocker.includes("Confirming")));
});
