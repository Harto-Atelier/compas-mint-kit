import assert from "node:assert/strict";
import test from "node:test";

import {
  GUIDED_FUNDING_AUTO_VERIFY_INTERVAL_MS,
  GUIDED_SESSION_STORAGE_KEY,
  buildGuidedSessionSnapshot,
  clearGuidedSessionSnapshot,
  describeGuidedSessionResume,
  mergeRestoredGuidedFundingSubmissions,
  parseGuidedSessionSnapshot,
  planGuidedFundingAutoVerification,
  readGuidedSessionSnapshot,
  resolveGuidedResumeStep,
  writeGuidedSessionSnapshot,
} from "./guided-session-persistence";

const PRIVATE_KEY = `0x${"1".repeat(64)}`;
const FUND_HASH = `0x${"b".repeat(64)}`;
const COLLECTION = "0x1111111111111111111111111111111111111111";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    size: () => map.size,
  };
}

function snapshot() {
  return buildGuidedSessionSnapshot({
    step: "funding",
    drop: { query: "guided-drop", chainKey: "base", collectionAddress: COLLECTION, collectionName: "Guided drop" },
    fundingSubmissions: [{ transactionId: "fund-burner-1", hash: FUND_HASH }],
    fundingVerifications: [{ transactionId: "fund-burner-1", hash: FUND_HASH, verified: false }],
    updatedAt: "2026-08-30T00:00:00.000Z",
  });
}

test("guided session snapshot survives a storage roundtrip with only public resume evidence", () => {
  const storage = memoryStorage();
  writeGuidedSessionSnapshot(storage, snapshot());

  const restored = readGuidedSessionSnapshot(storage);
  assert.ok(restored);
  assert.equal(GUIDED_SESSION_STORAGE_KEY, "compas-guided-session-v1");
  assert.equal(restored.step, "funding");
  assert.equal(restored.drop?.collectionName, "Guided drop");
  assert.equal(restored.drop?.chainKey, "base");
  assert.equal(restored.fundingSubmissions[0].hash, FUND_HASH);
  assert.equal(restored.fundingVerifications[0].verified, false);
  const serialized = storage.getItem(GUIDED_SESSION_STORAGE_KEY)!;
  assert.equal(serialized.includes(PRIVATE_KEY.slice(2)), false);
  assert.equal(/privateKey|passphrase|mnemonic|seed|password|secret/i.test(serialized), false);

  clearGuidedSessionSnapshot(storage);
  assert.equal(readGuidedSessionSnapshot(storage), null);
});

test("guided session snapshot rejects secrets by key and by value", () => {
  // Secret-shaped value in a free-text field is rejected even without a telltale key.
  assert.throws(() => buildGuidedSessionSnapshot({
    step: "funding",
    drop: { query: `imported ${PRIVATE_KEY}`, chainKey: "base", collectionAddress: null, collectionName: null },
    fundingSubmissions: [],
    fundingVerifications: [],
  }), /secret-shaped/);
  assert.throws(() => buildGuidedSessionSnapshot({
    step: "funding",
    drop: { query: "drop", chainKey: "base", collectionAddress: null, collectionName: "1".repeat(64) },
    fundingSubmissions: [],
    fundingVerifications: [],
  }), /secret-shaped/);
  // Forbidden key names are rejected recursively, including passphrases.
  for (const key of ["privateKey", "vaultPassphrase", "mnemonic", "walletSeed", "password"]) {
    const raw = JSON.stringify({
      schemaVersion: "compas.guided-session.v1",
      updatedAt: "2026-08-30T00:00:00.000Z",
      step: "funding",
      drop: null,
      fundingSubmissions: [],
      fundingVerifications: [],
      extra: { [key]: "x" },
    });
    assert.throws(() => parseGuidedSessionSnapshot(raw), /forbidden secret field/);
  }
  // Hash fields only accept exact transaction-hash shapes.
  assert.throws(() => buildGuidedSessionSnapshot({
    step: "funding",
    drop: null,
    fundingSubmissions: [{ transactionId: "fund-burner-1", hash: "0x1234" }],
    fundingVerifications: [],
  }), /transaction hash/);
  // Unknown steps and broken schema are rejected.
  assert.throws(() => parseGuidedSessionSnapshot(JSON.stringify({
    schemaVersion: "compas.guided-session.v1",
    updatedAt: "2026-08-30T00:00:00.000Z",
    step: "teleport",
    drop: null,
    fundingSubmissions: [],
    fundingVerifications: [],
  })), /known guided step/);
  assert.throws(() => parseGuidedSessionSnapshot("not json"), /not valid JSON/);
});

test("resume state clamps to the reachable step and names the saved mint", () => {
  const restored = snapshot();
  const resume = describeGuidedSessionResume(restored);
  assert.equal(resume.mintName, "Guided drop");
  assert.equal(resume.stepLabel, "Fund");

  // A reload drops in-memory signers, so resume never jumps past reachability.
  assert.equal(resolveGuidedResumeStep("funding", "burners"), "burners");
  assert.equal(resolveGuidedResumeStep("drop", "receipts"), "drop");
  assert.equal(resolveGuidedResumeStep("mint", "mint"), "mint");
});

test("restored funding submissions rehydrate only rows matching the rebuilt plan", () => {
  const plan = { transactions: [{ id: "fund-burner-1" }, { id: "fund-burner-2" }] } as Parameters<typeof mergeRestoredGuidedFundingSubmissions>[0];
  const merged = mergeRestoredGuidedFundingSubmissions(plan, [
    { transactionId: "fund-burner-1", hash: FUND_HASH },
    { transactionId: "fund-burner-9", hash: FUND_HASH },
  ], {});
  assert.deepEqual(Object.keys(merged), ["fund-burner-1"]);
  assert.equal(merged["fund-burner-1"].hash, FUND_HASH);
  assert.equal(merged["fund-burner-1"].status, "awaiting-receipt-and-balance-verification");

  // Existing in-memory submissions are never overwritten by restored rows.
  const existing = {
    "fund-burner-1": {
      schemaVersion: "compas.connected-holder-funding-submission.v1" as const,
      transactionId: "fund-burner-1",
      hash: `0x${"c".repeat(64)}`,
      status: "awaiting-receipt-and-balance-verification" as const,
    },
  };
  const kept = mergeRestoredGuidedFundingSubmissions(plan, [{ transactionId: "fund-burner-1", hash: FUND_HASH }], existing);
  assert.equal(kept["fund-burner-1"].hash, `0x${"c".repeat(64)}`);
});

test("funding auto-verification retries unverified rows every interval and never self-confirms", () => {
  const submissions = [{ transactionId: "fund-burner-1" }, { transactionId: "fund-burner-2" }];

  // First pass: nothing attempted yet, everything unverified is due immediately.
  const first = planGuidedFundingAutoVerification({ submissions, verifications: [], lastAttemptAt: {}, now: 1_000 });
  assert.deepEqual(first.due, ["fund-burner-1", "fund-burner-2"]);
  assert.equal(first.nextDelayMs, 0);

  // A failed/malformed verification result stays retryable — it is still due after the interval.
  const afterFailure = planGuidedFundingAutoVerification({
    submissions,
    verifications: [{ transactionId: "fund-burner-1", verified: false }],
    lastAttemptAt: { "fund-burner-1": 1_000, "fund-burner-2": 1_000 },
    now: 1_000 + GUIDED_FUNDING_AUTO_VERIFY_INTERVAL_MS,
    });
  assert.deepEqual(afterFailure.due, ["fund-burner-1", "fund-burner-2"]);

  // Inside the interval nothing fires; the scheduler waits the remaining time.
  const waiting = planGuidedFundingAutoVerification({
    submissions,
    verifications: [],
    lastAttemptAt: { "fund-burner-1": 1_000, "fund-burner-2": 2_000 },
    now: 3_000,
  });
  assert.deepEqual(waiting.due, []);
  assert.equal(waiting.nextDelayMs, 3_000);

  // Only a verified=true result retires a row; it can never be produced here.
  const oneVerified = planGuidedFundingAutoVerification({
    submissions,
    verifications: [{ transactionId: "fund-burner-1", verified: true }],
    lastAttemptAt: {},
    now: 10_000,
  });
  assert.deepEqual(oneVerified.due, ["fund-burner-2"]);

  const allVerified = planGuidedFundingAutoVerification({
    submissions,
    verifications: [
      { transactionId: "fund-burner-1", verified: true },
      { transactionId: "fund-burner-2", verified: true },
    ],
    lastAttemptAt: {},
    now: 10_000,
  });
  assert.deepEqual(allVerified.due, []);
  assert.equal(allVerified.nextDelayMs, null);

  assert.throws(() => planGuidedFundingAutoVerification({ submissions, verifications: [], lastAttemptAt: {}, now: 0, intervalMs: 0 }), /positive/);
});
