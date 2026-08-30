import type { BurnerFundingPlan } from "./burner-funding";
import type { ConnectedHolderFundingSubmission } from "./connected-holder-funding";
import { GUIDED_HOLDER_STEPS, type GuidedHolderStepId } from "./guided-holder-flow";
import { assertNoForbiddenKeys, containsSecretShapedValue } from "./guided-holder-recovery";

/**
 * Secret-free guided-run session snapshot.
 *
 * Persists only public resume evidence: the selected drop, the current step,
 * funding submission hashes, and funding verification results. It reuses the
 * secret-free-by-value pattern from guided-holder-recovery: forbidden key names
 * are rejected recursively and every free-text field rejects secret-shaped
 * 64-hex values. Transaction hashes are public chain identifiers and are only
 * accepted inside dedicated, format-validated hash fields.
 *
 * NO private keys, NO passphrases, NO signer material ever enters this record.
 */
export const GUIDED_SESSION_STORAGE_KEY = "compas-guided-session-v1";
export const GUIDED_FUNDING_AUTO_VERIFY_INTERVAL_MS = 5_000;

export type GuidedSessionDropSelection = {
  query: string;
  chainKey: "base" | "ethereum";
  collectionAddress: string | null;
  collectionName: string | null;
};

export type GuidedSessionFundingSubmission = { transactionId: string; hash: string };
export type GuidedSessionFundingVerification = { transactionId: string; hash: string; verified: boolean };

export type GuidedSessionSnapshot = {
  schemaVersion: "compas.guided-session.v1";
  updatedAt: string;
  step: GuidedHolderStepId;
  drop: GuidedSessionDropSelection | null;
  fundingSubmissions: GuidedSessionFundingSubmission[];
  fundingVerifications: GuidedSessionFundingVerification[];
};

type StorageReader = { getItem(key: string): string | null };
type StorageWriter = { setItem(key: string, value: string): void };
type StorageRemover = { removeItem(key: string): void };

const STEP_IDS = new Set<string>(GUIDED_HOLDER_STEPS.map((step) => step.id));
const FORBIDDEN_SESSION_KEY = /private.?key|raw.?signed|signed.?transaction|seed|mnemonic|passphrase|password|secret/i;

export function buildGuidedSessionSnapshot(input: {
  step: GuidedHolderStepId;
  drop: GuidedSessionDropSelection | null;
  fundingSubmissions: readonly GuidedSessionFundingSubmission[];
  fundingVerifications: readonly GuidedSessionFundingVerification[];
  updatedAt?: string;
}): GuidedSessionSnapshot {
  return parseGuidedSessionSnapshot(JSON.stringify({
    schemaVersion: "compas.guided-session.v1",
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    step: input.step,
    drop: input.drop,
    fundingSubmissions: input.fundingSubmissions.map((row) => ({ transactionId: row.transactionId, hash: row.hash })),
    fundingVerifications: input.fundingVerifications.map((row) => ({ transactionId: row.transactionId, hash: row.hash, verified: row.verified })),
  }));
}

export function parseGuidedSessionSnapshot(raw: string): GuidedSessionSnapshot {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 100_000) throw new Error("Guided session snapshot is empty or oversized.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Guided session snapshot is not valid JSON.");
  }
  assertNoForbiddenKeys(parsed);
  assertNoForbiddenSessionKeys(parsed);
  const record = asRecord(parsed);
  if (!record || record.schemaVersion !== "compas.guided-session.v1") throw new Error("Unsupported guided session snapshot schema.");
  const updatedAt = requireIsoDate(record.updatedAt);
  if (typeof record.step !== "string" || !STEP_IDS.has(record.step)) throw new Error("Guided session step is not a known guided step.");
  const drop = record.drop === null || record.drop === undefined ? null : parseDropSelection(record.drop);
  const fundingSubmissions = requireArray(record.fundingSubmissions, "funding submissions").map((value) => {
    const row = asRecord(value);
    if (!row) throw new Error("Funding submission row is invalid.");
    return {
      transactionId: requirePublicString(row.transactionId, "funding transaction id", 200),
      hash: requireHash(row.hash, "funding transaction hash"),
    };
  });
  const fundingVerifications = requireArray(record.fundingVerifications, "funding verifications").map((value) => {
    const row = asRecord(value);
    if (!row || typeof row.verified !== "boolean") throw new Error("Funding verification row is invalid.");
    return {
      transactionId: requirePublicString(row.transactionId, "verification transaction id", 200),
      hash: requireHash(row.hash, "verification hash"),
      verified: row.verified,
    };
  });

  return {
    schemaVersion: "compas.guided-session.v1",
    updatedAt,
    step: record.step as GuidedHolderStepId,
    drop,
    fundingSubmissions,
    fundingVerifications,
  };
}

export function readGuidedSessionSnapshot(storage: StorageReader): GuidedSessionSnapshot | null {
  const raw = storage.getItem(GUIDED_SESSION_STORAGE_KEY);
  return raw ? parseGuidedSessionSnapshot(raw) : null;
}

export function writeGuidedSessionSnapshot(storage: StorageWriter, snapshot: GuidedSessionSnapshot): void {
  storage.setItem(GUIDED_SESSION_STORAGE_KEY, JSON.stringify(parseGuidedSessionSnapshot(JSON.stringify(snapshot))));
}

export function clearGuidedSessionSnapshot(storage: StorageRemover): void {
  storage.removeItem(GUIDED_SESSION_STORAGE_KEY);
}

export function describeGuidedSessionResume(snapshot: GuidedSessionSnapshot): { mintName: string; stepLabel: string } {
  const stepLabel = GUIDED_HOLDER_STEPS.find((step) => step.id === snapshot.step)?.label ?? snapshot.step;
  const mintName = snapshot.drop?.collectionName ?? snapshot.drop?.query ?? "your saved mint run";
  return { mintName, stepLabel };
}

/**
 * Resume never jumps past what the current in-memory run can actually reach:
 * the resumed step is the earlier of the persisted step and the currently
 * reachable step (Vault signers are memory-only, so a reload always requires
 * re-unlocking before funding/mint steps become reachable again).
 */
export function resolveGuidedResumeStep(persistedStep: GuidedHolderStepId, reachableStep: GuidedHolderStepId): GuidedHolderStepId {
  const persistedIndex = GUIDED_HOLDER_STEPS.findIndex((step) => step.id === persistedStep);
  const reachableIndex = GUIDED_HOLDER_STEPS.findIndex((step) => step.id === reachableStep);
  if (persistedIndex < 0) return reachableStep;
  if (reachableIndex < 0) return persistedStep;
  return GUIDED_HOLDER_STEPS[Math.min(persistedIndex, reachableIndex)].id;
}

export type GuidedFundingAutoVerifyPlan = {
  /** Transaction ids whose verification should be attempted now. */
  due: string[];
  /** Milliseconds until the next attempt window, or null when nothing is pending. */
  nextDelayMs: number | null;
};

/**
 * Pure scheduler for funding receipt auto-verification. A submission stays in
 * the retry set until a verification for it reports verified=true; failed or
 * malformed verification attempts therefore remain retryable forever and are
 * never treated as confirmed here. Attempts are spaced by intervalMs (~5s).
 */
export function planGuidedFundingAutoVerification(input: {
  submissions: readonly { transactionId: string }[];
  verifications: readonly { transactionId: string; verified: boolean }[];
  lastAttemptAt: Readonly<Record<string, number>>;
  now: number;
  intervalMs?: number;
}): GuidedFundingAutoVerifyPlan {
  const intervalMs = input.intervalMs ?? GUIDED_FUNDING_AUTO_VERIFY_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("Auto-verification interval must be a positive number of milliseconds.");
  const pending = input.submissions.filter((submission) => (
    !input.verifications.some((verification) => verification.transactionId === submission.transactionId && verification.verified === true)
  ));
  if (pending.length === 0) return { due: [], nextDelayMs: null };
  const due: string[] = [];
  let nextDelayMs = Number.POSITIVE_INFINITY;
  for (const submission of pending) {
    const last = input.lastAttemptAt[submission.transactionId];
    const waitMs = last === undefined ? 0 : Math.max(0, last + intervalMs - input.now);
    if (waitMs === 0) due.push(submission.transactionId);
    else nextDelayMs = Math.min(nextDelayMs, waitMs);
  }
  if (due.length > 0) return { due, nextDelayMs: 0 };
  return { due: [], nextDelayMs: Number.isFinite(nextDelayMs) ? nextDelayMs : intervalMs };
}

/**
 * Rehydrate persisted funding submissions against a freshly rebuilt funding
 * plan. Only rows whose transaction id exists in the reviewed plan are
 * restored, and existing in-memory submissions are never overwritten. Restored
 * rows carry only public hashes; they unlock nothing by themselves — receipt
 * verification still runs live against the chain before anything proceeds.
 */
export function mergeRestoredGuidedFundingSubmissions(
  plan: Pick<BurnerFundingPlan, "transactions">,
  restored: readonly GuidedSessionFundingSubmission[],
  current: Readonly<Record<string, ConnectedHolderFundingSubmission>>,
): Record<string, ConnectedHolderFundingSubmission> {
  const planIds = new Set(plan.transactions.map((row) => row.id));
  const next: Record<string, ConnectedHolderFundingSubmission> = { ...current };
  for (const row of restored) {
    if (!planIds.has(row.transactionId) || next[row.transactionId]) continue;
    if (!/^0x[0-9a-fA-F]{64}$/.test(row.hash)) continue;
    next[row.transactionId] = {
      schemaVersion: "compas.connected-holder-funding-submission.v1",
      transactionId: row.transactionId,
      hash: row.hash,
      status: "awaiting-receipt-and-balance-verification",
    };
  }
  return next;
}

function parseDropSelection(value: unknown): GuidedSessionDropSelection {
  const row = asRecord(value);
  if (!row) throw new Error("Guided session drop selection is invalid.");
  if (row.chainKey !== "base" && row.chainKey !== "ethereum") throw new Error("Guided session drop chain is unsupported.");
  return {
    query: requirePublicString(row.query, "drop query", 2_000),
    chainKey: row.chainKey,
    collectionAddress: row.collectionAddress === null || row.collectionAddress === undefined ? null : requireAddress(row.collectionAddress, "collection address"),
    collectionName: row.collectionName === null || row.collectionName === undefined ? null : requirePublicString(row.collectionName, "collection name", 200),
  };
}

function assertNoForbiddenSessionKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenSessionKeys(item);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, nested] of Object.entries(record)) {
    if (FORBIDDEN_SESSION_KEY.test(key)) throw new Error(`Guided session snapshot contains forbidden secret field: ${key}.`);
    assertNoForbiddenSessionKeys(nested);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > 200) throw new Error(`${label} must be a bounded array.`);
  return value;
}
function requireString(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error(`${label} is invalid.`);
  return value;
}
function requirePublicString(value: unknown, label: string, max: number): string {
  const text = requireString(value, label, max);
  if (containsSecretShapedValue(text)) throw new Error(`${label} contains a secret-shaped value.`);
  return text;
}
function requireHash(value: unknown, label: string): string {
  const text = requireString(value, label, 66);
  if (!/^0x[0-9a-fA-F]{64}$/.test(text)) throw new Error(`${label} must be a transaction hash.`);
  return text;
}
function requireAddress(value: unknown, label: string): string {
  const text = requireString(value, label, 42);
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) throw new Error(`${label} must be an EVM address.`);
  return text;
}
function requireIsoDate(value: unknown): string {
  const text = requireString(value, "updated at", 100);
  if (!Number.isFinite(Date.parse(text))) throw new Error("Guided session updatedAt is invalid.");
  return text;
}
