import assert from "node:assert/strict";
import test from "node:test";

import { buildBurnerFundingPlan, type BurnerFundingPlan } from "./burner-funding";
import {
  checkConnectedHolderFundingPreflight,
  submitConnectedHolderFundingTransaction,
  verifyConnectedHolderFundingTransaction,
  type Eip1193Provider,
} from "./connected-holder-funding";

const HOLDER = "0x1111111111111111111111111111111111111111";
const BURNER_ONE = "0x2222222222222222222222222222222222222222";
const BURNER_TWO = "0x3333333333333333333333333333333333333333";
const BURNER_ALT = "0x4444444444444444444444444444444444444444";

function fundingPlan(): BurnerFundingPlan {
  return buildBurnerFundingPlan({
    holder: { address: HOLDER, compasCount: 2, verifiedAt: 1_777_000_000_000 },
    chain: { key: "base", chainId: 8453 },
    burners: [BURNER_ONE, BURNER_TWO],
    mintPriceWei: BigInt("50000000000000000"),
    mintGasLimit: BigInt("120000"),
    maxFeePerGasWei: BigInt("2000000000"),
    bufferBps: 500,
    maxTotalSourceWei: BigInt("106000000000000000"),
  });
}

function providerWith(responses: Record<string, unknown>): Eip1193Provider & { calls: Array<{ method: string; params?: unknown[] | object }> } {
  const calls: Array<{ method: string; params?: unknown[] | object }> = [];
  return {
    calls,
    async request(args) {
      calls.push(args);
      if (!(args.method in responses)) throw new Error(`Unexpected provider method: ${args.method}`);
      return responses[args.method];
    },
  };
}

async function verifiedFundingRow(plan: BurnerFundingPlan, transactionId: string, hash: string) {
  const transaction = plan.transactions.find((row) => row.id === transactionId);
  assert.ok(transaction);
  return verifyConnectedHolderFundingTransaction({
    provider: providerWith({
      eth_getTransactionReceipt: { status: "0x1", transactionHash: hash, from: transaction.from, to: transaction.to },
      eth_getTransactionByHash: {
        hash,
        from: transaction.from,
        to: transaction.to,
        value: transaction.request.value,
        chainId: `0x${transaction.chainId.toString(16)}`,
      },
      eth_getBalance: transaction.request.value,
    }),
    plan,
    submission: {
      schemaVersion: "compas.connected-holder-funding-submission.v1",
      transactionId,
      hash,
      status: "awaiting-receipt-and-balance-verification",
    },
  });
}

test("checkConnectedHolderFundingPreflight verifies live chain, connected holder account, and source balance without sending", async () => {
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
  });

  const preflight = await checkConnectedHolderFundingPreflight(provider, fundingPlan());

  assert.equal(preflight.schemaVersion, "compas.connected-holder-funding-preflight.v1");
  assert.equal(preflight.ready, true);
  assert.equal(preflight.sourceAddress, HOLDER);
  assert.equal(preflight.chainId, 8453);
  assert.equal(preflight.requiredSourceWei, BigInt("105588000000000000"));
  assert.equal(preflight.balanceWei, BigInt("105600000000000000"));
  assert.equal(preflight.checks.every((check) => check.ok), true);
  assert.deepEqual(provider.calls, [
    { method: "eth_chainId" },
    { method: "eth_accounts" },
    { method: "eth_getBalance", params: [HOLDER, "latest"] },
  ]);
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("submitConnectedHolderFundingTransaction requires per-transaction consent and invokes only the connected EIP-1193 wallet", async () => {
  const hash = `0x${"a".repeat(64)}`;
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: hash,
  });
  const plan = fundingPlan();
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({ provider, plan, preflight, transactionId: "fund-burner-1", explicitConsent: false, priorVerifications: [] }),
    /explicit wallet confirmation/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);

  const submission = await submitConnectedHolderFundingTransaction({
    provider,
    plan,
    preflight,
    transactionId: "fund-burner-1",
    explicitConsent: true,
    priorVerifications: [],
  });

  assert.deepEqual(submission, {
    schemaVersion: "compas.connected-holder-funding-submission.v1",
    transactionId: "fund-burner-1",
    hash,
    status: "awaiting-receipt-and-balance-verification",
  });
  assert.deepEqual(provider.calls.filter((call) => call.method === "eth_sendTransaction"), [
    {
      method: "eth_sendTransaction",
      params: [{ from: HOLDER, to: BURNER_ONE, value: "0xbb69aa1d310000" }],
    },
  ]);
});

test("submitConnectedHolderFundingTransaction gates each later burner on verification of every prior funding row", async () => {
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: `0x${"b".repeat(64)}`,
  });
  const plan = fundingPlan();
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({ provider, plan, preflight, transactionId: "fund-burner-2", explicitConsent: true, priorVerifications: [] }),
    /verify.*previous funding transaction/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);

  const verification = await verifyConnectedHolderFundingTransaction({
    provider: providerWith({
      eth_getTransactionReceipt: { status: "0x1", transactionHash: `0x${"b".repeat(64)}`, from: HOLDER, to: BURNER_ONE },
      eth_getTransactionByHash: { hash: `0x${"b".repeat(64)}`, from: HOLDER, to: BURNER_ONE, value: "0xbb69aa1d310000", chainId: "0x2105" },
      eth_getBalance: "0xbb69aa1d310000",
    }),
    plan,
    submission: {
      schemaVersion: "compas.connected-holder-funding-submission.v1",
      transactionId: "fund-burner-1",
      hash: `0x${"b".repeat(64)}`,
      status: "awaiting-receipt-and-balance-verification",
    },
  });
  const submission = await submitConnectedHolderFundingTransaction({
    provider,
    plan,
    preflight,
    transactionId: "fund-burner-2",
    explicitConsent: true,
    priorVerifications: [verification],
  });
  assert.equal(submission.transactionId, "fund-burner-2");
  assert.equal(provider.calls.filter((call) => call.method === "eth_sendTransaction").length, 1);
});

test("submitConnectedHolderFundingTransaction rejects caller-forged prior verification booleans", async () => {
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: `0x${"9".repeat(64)}`,
  });
  const plan = fundingPlan();
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({
      provider,
      plan,
      preflight,
      transactionId: "fund-burner-2",
      explicitConsent: true,
      priorVerifications: [{ transactionId: "fund-burner-1", verified: true }],
    }),
    /verified receipt and balance record.*previous funding transaction/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("submitConnectedHolderFundingTransaction rejects a trusted verification produced for a different funding plan", async () => {
  const hash = `0x${"8".repeat(64)}`;
  const verifiedPlan = fundingPlan();
  const verification = await verifyConnectedHolderFundingTransaction({
    provider: providerWith({
      eth_getTransactionReceipt: { status: "0x1", transactionHash: hash, from: HOLDER, to: BURNER_ONE },
      eth_getTransactionByHash: { hash, from: HOLDER, to: BURNER_ONE, value: "0xbb69aa1d310000", chainId: "0x2105" },
      eth_getBalance: "0xbb69aa1d310000",
    }),
    plan: verifiedPlan,
    submission: {
      schemaVersion: "compas.connected-holder-funding-submission.v1",
      transactionId: "fund-burner-1",
      hash,
      status: "awaiting-receipt-and-balance-verification",
    },
  });
  const submittedPlan = fundingPlan();
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: `0x${"7".repeat(64)}`,
  });
  const preflight = await checkConnectedHolderFundingPreflight(provider, submittedPlan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({
      provider,
      plan: submittedPlan,
      preflight,
      transactionId: "fund-burner-2",
      explicitConsent: true,
      priorVerifications: [verification],
    }),
    /verified receipt and balance record.*previous funding transaction/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("submitConnectedHolderFundingTransaction rejects a trusted verification whose transaction hash was changed", async () => {
  const plan = fundingPlan();
  const verification = await verifiedFundingRow(plan, "fund-burner-1", `0x${"6".repeat(64)}`);
  verification.hash = `0x${"5".repeat(64)}`;
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: `0x${"4".repeat(64)}`,
  });
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({
      provider,
      plan,
      preflight,
      transactionId: "fund-burner-2",
      explicitConsent: true,
      priorVerifications: [verification],
    }),
    /verified receipt and balance record.*previous funding transaction/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("submitConnectedHolderFundingTransaction rejects a trusted verification relabeled as another transaction", async () => {
  const plan = fundingPlan();
  const verification = await verifiedFundingRow(plan, "fund-burner-2", `0x${"3".repeat(64)}`);
  verification.transactionId = "fund-burner-1";
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: `0x${"2".repeat(64)}`,
  });
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({
      provider,
      plan,
      preflight,
      transactionId: "fund-burner-2",
      explicitConsent: true,
      priorVerifications: [verification],
    }),
    /verified receipt and balance record.*previous funding transaction/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("submitConnectedHolderFundingTransaction rejects a trusted verification whose checks were changed", async () => {
  const plan = fundingPlan();
  const verification = await verifiedFundingRow(plan, "fund-burner-1", `0x${"1".repeat(64)}`);
  verification.checks[0].ok = false;
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: `0x${"0".repeat(64)}`,
  });
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({
      provider,
      plan,
      preflight,
      transactionId: "fund-burner-2",
      explicitConsent: true,
      priorVerifications: [verification],
    }),
    /verified receipt and balance record.*previous funding transaction/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("submitConnectedHolderFundingTransaction rejects a trusted verification after any reviewed plan field changes", async () => {
  const plan = fundingPlan();
  const verification = await verifiedFundingRow(plan, "fund-burner-1", `0x${"a".repeat(64)}`);
  plan.transactions[0].mintPriceWei += BigInt(1);
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: `0x${"b".repeat(64)}`,
  });
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({
      provider,
      plan,
      preflight,
      transactionId: "fund-burner-2",
      explicitConsent: true,
      priorVerifications: [verification],
    }),
    /verified receipt and balance record.*previous funding transaction/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("submitConnectedHolderFundingTransaction rejects mutated transaction indices instead of bypassing prior-row verification", async () => {
  const plan = fundingPlan();
  plan.transactions[1].index = 0;
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: `0x${"c".repeat(64)}`,
  });
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({
      provider,
      plan,
      preflight,
      transactionId: "fund-burner-2",
      explicitConsent: true,
      priorVerifications: [],
    }),
    /funding transaction order.*reviewed plan/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("submitConnectedHolderFundingTransaction rejects reordered transaction ids that bypass prior rows", async () => {
  const plan = fundingPlan();
  plan.transactions[0].id = "fund-burner-2";
  plan.transactions[1].id = "fund-burner-1";
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: `0x${"e".repeat(64)}`,
  });
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({
      provider,
      plan,
      preflight,
      transactionId: "fund-burner-2",
      explicitConsent: true,
      priorVerifications: [],
    }),
    /funding transaction order.*reviewed plan/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("submitConnectedHolderFundingTransaction rejects a tampered transaction request", async () => {
  const plan = fundingPlan();
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: `0x${"f".repeat(64)}`,
  });
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);
  plan.transactions[0].request.to = BURNER_ALT;

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({
      provider,
      plan,
      preflight,
      transactionId: "fund-burner-1",
      explicitConsent: true,
      priorVerifications: [],
    }),
    /funding transaction request.*reviewed plan/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("connected-holder preflight rejects internally inconsistent funding requests before any RPC read", async () => {
  const plan = fundingPlan();
  plan.transactions[0].request.value = "0x1";
  const provider = providerWith({});

  await assert.rejects(
    () => checkConnectedHolderFundingPreflight(provider, plan),
    /funding transaction request.*reviewed plan/i,
  );
  assert.deepEqual(provider.calls, []);
});

test("submitConnectedHolderFundingTransaction rejects caller-cloned preflight records", async () => {
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: `0x${"d".repeat(64)}`,
  });
  const plan = fundingPlan();
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);
  const clonedPreflight = {
    ...preflight,
    checks: preflight.checks.map((check) => ({ ...check })),
  };

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({
      provider,
      plan,
      preflight: clonedPreflight,
      transactionId: "fund-burner-1",
      explicitConsent: true,
      priorVerifications: [],
    }),
    /preflight record produced in this runtime/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("submitConnectedHolderFundingTransaction rejects a preflight from a different recipient review", async () => {
  const provider = providerWith({
    eth_chainId: "0x2105",
    eth_accounts: [HOLDER],
    eth_getBalance: "0x1772aa3f8480000",
    eth_sendTransaction: `0x${"d".repeat(64)}`,
  });
  const reviewedPlan = fundingPlan();
  const alteredPlan = buildBurnerFundingPlan({
    holder: reviewedPlan.source,
    chain: { key: "base", chainId: 8453 },
    burners: [BURNER_ALT, BURNER_TWO],
    mintPriceWei: BigInt("50000000000000000"),
    mintGasLimit: BigInt("120000"),
    maxFeePerGasWei: BigInt("2000000000"),
    bufferBps: 500,
    maxTotalSourceWei: BigInt("106000000000000000"),
  });
  const preflight = await checkConnectedHolderFundingPreflight(provider, reviewedPlan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({ provider, plan: alteredPlan, preflight, transactionId: "fund-burner-1", explicitConsent: true, priorVerifications: [] }),
    /preflight does not match.*reviewed funding plan/i,
  );
  assert.equal(provider.calls.some((call) => call.method === "eth_sendTransaction"), false);
});

test("submitConnectedHolderFundingTransaction rechecks live chain and holder account immediately before wallet send", async () => {
  let chainReads = 0;
  let sent = false;
  const provider: Eip1193Provider = {
    async request(args) {
      if (args.method === "eth_chainId") {
        chainReads += 1;
        return chainReads === 1 ? "0x2105" : "0x1";
      }
      if (args.method === "eth_accounts") return [HOLDER];
      if (args.method === "eth_getBalance") return "0x1772aa3f8480000";
      if (args.method === "eth_sendTransaction") {
        sent = true;
        return `0x${"e".repeat(64)}`;
      }
      throw new Error(`Unexpected provider method: ${args.method}`);
    },
  };
  const plan = fundingPlan();
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({ provider, plan, preflight, transactionId: "fund-burner-1", explicitConsent: true, priorVerifications: [] }),
    /connected chain changed/i,
  );
  assert.equal(sent, false);
});

test("submitConnectedHolderFundingTransaction rechecks source balance for the selected row before wallet send", async () => {
  let balanceReads = 0;
  let sent = false;
  const provider: Eip1193Provider = {
    async request(args) {
      if (args.method === "eth_chainId") return "0x2105";
      if (args.method === "eth_accounts") return [HOLDER];
      if (args.method === "eth_getBalance") {
        balanceReads += 1;
        return balanceReads === 1 ? "0x1772aa3f8480000" : "0x0";
      }
      if (args.method === "eth_sendTransaction") {
        sent = true;
        return `0x${"f".repeat(64)}`;
      }
      throw new Error(`Unexpected provider method: ${args.method}`);
    },
  };
  const plan = fundingPlan();
  const preflight = await checkConnectedHolderFundingPreflight(provider, plan);

  await assert.rejects(
    () => submitConnectedHolderFundingTransaction({ provider, plan, preflight, transactionId: "fund-burner-1", explicitConsent: true, priorVerifications: [] }),
    /balance changed.*selected funding transaction/i,
  );
  assert.equal(sent, false);
});

test("verifyConnectedHolderFundingTransaction gates completion on a successful matching receipt, transaction value, and recipient balance", async () => {
  const hash = `0x${"c".repeat(64)}`;
  const provider = providerWith({
    eth_getTransactionReceipt: { status: "0x1", transactionHash: hash, from: HOLDER, to: BURNER_ONE },
    eth_getTransactionByHash: { hash, from: HOLDER, to: BURNER_ONE, value: "0xbb69aa1d310000", chainId: "0x2105" },
    eth_getBalance: "0xbb69aa1d310000",
  });
  const plan = fundingPlan();

  const verification = await verifyConnectedHolderFundingTransaction({
    provider,
    plan,
    submission: {
      schemaVersion: "compas.connected-holder-funding-submission.v1",
      transactionId: "fund-burner-1",
      hash,
      status: "awaiting-receipt-and-balance-verification",
    },
  });

  assert.equal(verification.schemaVersion, "compas.connected-holder-funding-verification.v1");
  assert.equal(verification.transactionId, "fund-burner-1");
  assert.equal(verification.hash, hash);
  assert.equal(verification.verified, true);
  assert.equal(verification.recipientBalanceWei, BigInt("52752000000000000"));
  assert.equal(verification.checks.every((check) => check.ok), true);
  assert.deepEqual(provider.calls, [
    { method: "eth_getTransactionReceipt", params: [hash] },
    { method: "eth_getTransactionByHash", params: [hash] },
    { method: "eth_getBalance", params: [BURNER_ONE, "latest"] },
  ]);
});
