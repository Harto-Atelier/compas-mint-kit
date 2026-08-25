import type { BurnerFundingPlan } from "./burner-funding";

export interface Eip1193RequestArguments {
  method: string;
  params?: unknown[] | object;
}

export interface Eip1193Provider {
  request(args: Eip1193RequestArguments): Promise<unknown>;
}

export interface ConnectedHolderFundingCheck {
  id: "plan" | "chain" | "account" | "balance";
  label: string;
  ok: boolean;
  detail: string;
}

export interface ConnectedHolderFundingPreflight {
  schemaVersion: "compas.connected-holder-funding-preflight.v1";
  ready: boolean;
  sourceAddress: string;
  chainId: number;
  requiredSourceWei: bigint;
  balanceWei: bigint;
  reviewKey: string;
  checks: ConnectedHolderFundingCheck[];
}

interface TrustedConnectedHolderFundingPreflight {
  plan: BurnerFundingPlan;
  planReviewKey: string;
  preflightKey: string;
}

const TRUSTED_FUNDING_PREFLIGHTS = new WeakMap<object, TrustedConnectedHolderFundingPreflight>();

export async function checkConnectedHolderFundingPreflight(
  provider: Eip1193Provider,
  plan: BurnerFundingPlan,
): Promise<ConnectedHolderFundingPreflight> {
  assertFundingTransactionRequestsMatchPlan(plan);
  const rawChainId = await provider.request({ method: "eth_chainId" });
  const rawAccounts = await provider.request({ method: "eth_accounts" });
  const rawBalance = await provider.request({ method: "eth_getBalance", params: [plan.source.address, "latest"] });

  const liveChainId = parseRpcQuantity(rawChainId);
  const accounts = Array.isArray(rawAccounts) ? rawAccounts.filter((value): value is string => typeof value === "string") : [];
  const connectedSource = accounts.some((address) => address.toLowerCase() === plan.source.address.toLowerCase());
  const balanceWei = parseRpcQuantity(rawBalance) ?? BigInt(0);
  const checks: ConnectedHolderFundingCheck[] = [
    {
      id: "plan",
      label: "Funding review approved",
      ok: plan.review.readyForFunding,
      detail: plan.review.readyForFunding ? "Planner validation and source cap passed." : "Planner review is blocked.",
    },
    {
      id: "chain",
      label: "Connected chain matches funding plan",
      ok: liveChainId === BigInt(plan.chain.chainId),
      detail: `connected=${liveChainId?.toString() ?? "invalid"} planned=${plan.chain.chainId}`,
    },
    {
      id: "account",
      label: "Connected account is the verified Compas holder",
      ok: connectedSource,
      detail: connectedSource ? plan.source.address : "Verified holder account is not connected.",
    },
    {
      id: "balance",
      label: "Holder balance covers funding values and transfer gas budget",
      ok: balanceWei >= plan.totals.sourceTotalWei,
      detail: `balance=${balanceWei} required=${plan.totals.sourceTotalWei} wei`,
    },
  ];

  const preflight: ConnectedHolderFundingPreflight = {
    schemaVersion: "compas.connected-holder-funding-preflight.v1",
    ready: checks.every((check) => check.ok),
    sourceAddress: plan.source.address,
    chainId: plan.chain.chainId,
    requiredSourceWei: plan.totals.sourceTotalWei,
    balanceWei,
    reviewKey: fundingReviewKey(plan),
    checks,
  };
  TRUSTED_FUNDING_PREFLIGHTS.set(preflight, {
    plan,
    planReviewKey: fundingReviewKey(plan),
    preflightKey: fundingPreflightKey(preflight),
  });
  return preflight;
}

export interface ConnectedHolderFundingSubmission {
  schemaVersion: "compas.connected-holder-funding-submission.v1";
  transactionId: string;
  hash: string;
  status: "awaiting-receipt-and-balance-verification";
}

export interface ConnectedHolderFundingVerificationRef {
  transactionId: string;
  verified: boolean;
}

export interface SubmitConnectedHolderFundingInput {
  provider: Eip1193Provider;
  plan: BurnerFundingPlan;
  preflight: ConnectedHolderFundingPreflight;
  transactionId: string;
  explicitConsent: boolean;
  priorVerifications: readonly ConnectedHolderFundingVerificationRef[];
}

interface TrustedConnectedHolderFundingVerification {
  plan: BurnerFundingPlan;
  planReviewKey: string;
  transactionId: string;
  hash: string;
  verificationKey: string;
}

const TRUSTED_FUNDING_VERIFICATIONS = new WeakMap<object, TrustedConnectedHolderFundingVerification>();

export async function submitConnectedHolderFundingTransaction(
  input: SubmitConnectedHolderFundingInput,
): Promise<ConnectedHolderFundingSubmission> {
  if (!input.explicitConsent) throw new Error("Explicit wallet confirmation is required for this funding transaction.");
  assertFundingTransactionRequestsMatchPlan(input.plan);
  const currentPlanReviewKey = fundingReviewKey(input.plan);
  const trustedPreflight = TRUSTED_FUNDING_PREFLIGHTS.get(input.preflight);
  if (
    trustedPreflight?.plan !== input.plan ||
    trustedPreflight.planReviewKey !== currentPlanReviewKey ||
    trustedPreflight.preflightKey !== fundingPreflightKey(input.preflight)
  ) {
    throw new Error("Funding preflight does not match the reviewed funding plan or a preflight record produced in this runtime.");
  }
  if (!input.preflight.ready) throw new Error("Connected holder funding preflight must pass before requesting wallet confirmation.");
  if (
    input.preflight.sourceAddress.toLowerCase() !== input.plan.source.address.toLowerCase() ||
    input.preflight.chainId !== input.plan.chain.chainId ||
    input.preflight.requiredSourceWei !== input.plan.totals.sourceTotalWei ||
    input.preflight.reviewKey !== currentPlanReviewKey
  ) {
    throw new Error("Funding preflight does not match the reviewed funding plan.");
  }

  const transactionPosition = input.plan.transactions.findIndex((row) => row.id === input.transactionId);
  if (transactionPosition < 0) throw new Error(`Unknown funding transaction: ${input.transactionId}`);
  const transaction = input.plan.transactions[transactionPosition];
  const transactionIds = new Set(input.plan.transactions.map((row) => row.id));
  if (
    transactionIds.size !== input.plan.transactions.length ||
    input.plan.transactions.some((row, index) => (
      row.index !== index ||
      row.id !== `fund-burner-${index + 1}`
    ))
  ) {
    throw new Error("Funding transaction order does not match the reviewed plan.");
  }
  const priorRows = input.plan.transactions.slice(0, transactionPosition);
  const hasVerifiedPriorRows = priorRows.every((row) => input.priorVerifications.some((verification) => {
    const trusted = TRUSTED_FUNDING_VERIFICATIONS.get(verification);
    const fullVerification = verification as Partial<ConnectedHolderFundingVerification>;
    return verification.transactionId === row.id &&
      verification.verified &&
      trusted?.plan === input.plan &&
      trusted.planReviewKey === currentPlanReviewKey &&
      trusted.transactionId === row.id &&
      sameHex(fullVerification.hash, trusted.hash) &&
      fundingVerificationKey(fullVerification) === trusted.verificationKey;
  }));
  if (!hasVerifiedPriorRows) {
    throw new Error("Verify a verified receipt and balance record produced in this runtime for every previous funding transaction.");
  }

  const liveChainId = parseRpcQuantity(await input.provider.request({ method: "eth_chainId" }));
  if (liveChainId !== BigInt(input.plan.chain.chainId)) throw new Error("Connected chain changed after preflight. Review funding again before sending.");
  const rawAccounts = await input.provider.request({ method: "eth_accounts" });
  const accounts = Array.isArray(rawAccounts) ? rawAccounts.filter((value): value is string => typeof value === "string") : [];
  if (!accounts.some((address) => address.toLowerCase() === input.plan.source.address.toLowerCase())) {
    throw new Error("Connected account changed after preflight. Reconnect the verified Compas holder before sending.");
  }
  const liveSourceBalance = parseRpcQuantity(await input.provider.request({ method: "eth_getBalance", params: [input.plan.source.address, "latest"] })) ?? BigInt(0);
  if (liveSourceBalance < transaction.sourceTotalWei) {
    throw new Error("Connected holder balance changed and no longer covers the selected funding transaction plus its transfer gas budget.");
  }

  const rawHash = await input.provider.request({ method: "eth_sendTransaction", params: [transaction.request] });
  if (typeof rawHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(rawHash)) throw new Error("Connected wallet returned an invalid funding transaction hash.");

  return {
    schemaVersion: "compas.connected-holder-funding-submission.v1",
    transactionId: transaction.id,
    hash: rawHash,
    status: "awaiting-receipt-and-balance-verification",
  };
}

export interface ConnectedHolderFundingVerificationCheck {
  id: "receipt" | "transaction" | "balance";
  label: string;
  ok: boolean;
  detail: string;
}

export interface ConnectedHolderFundingVerification extends ConnectedHolderFundingVerificationRef {
  schemaVersion: "compas.connected-holder-funding-verification.v1";
  hash: string;
  recipientBalanceWei: bigint;
  checks: ConnectedHolderFundingVerificationCheck[];
}

export async function verifyConnectedHolderFundingTransaction(input: {
  provider: Eip1193Provider;
  plan: BurnerFundingPlan;
  submission: ConnectedHolderFundingSubmission;
}): Promise<ConnectedHolderFundingVerification> {
  assertFundingTransactionRequestsMatchPlan(input.plan);
  const transaction = input.plan.transactions.find((row) => row.id === input.submission.transactionId);
  if (!transaction) throw new Error(`Funding submission does not match this plan: ${input.submission.transactionId}`);

  const rawReceipt = await input.provider.request({ method: "eth_getTransactionReceipt", params: [input.submission.hash] });
  const rawTransaction = await input.provider.request({ method: "eth_getTransactionByHash", params: [input.submission.hash] });
  const rawBalance = await input.provider.request({ method: "eth_getBalance", params: [transaction.to, "latest"] });
  const receipt = asRecord(rawReceipt);
  const chainTransaction = asRecord(rawTransaction);
  const recipientBalanceWei = parseRpcQuantity(rawBalance) ?? BigInt(0);

  const receiptMatches = Boolean(
    receipt &&
    receipt.status === "0x1" &&
    sameAddress(receipt.from, transaction.from) &&
    sameAddress(receipt.to, transaction.to) &&
    sameHex(receipt.transactionHash, input.submission.hash),
  );
  const transactionMatches = Boolean(
    chainTransaction &&
    sameHex(chainTransaction.hash, input.submission.hash) &&
    sameAddress(chainTransaction.from, transaction.from) &&
    sameAddress(chainTransaction.to, transaction.to) &&
    parseRpcQuantity(chainTransaction.value) === transaction.fundingValueWei &&
    parseRpcQuantity(chainTransaction.chainId) === BigInt(transaction.chainId),
  );
  const balanceReady = recipientBalanceWei >= transaction.fundingValueWei;
  const checks: ConnectedHolderFundingVerificationCheck[] = [
    { id: "receipt", label: "Funding receipt succeeded and matches source/recipient", ok: receiptMatches, detail: receipt ? String(receipt.status ?? "missing status") : "Receipt is pending or unavailable." },
    { id: "transaction", label: "Onchain transaction matches reviewed funding value", ok: transactionMatches, detail: `expected ${transaction.fundingValueWei} wei to ${transaction.to}` },
    { id: "balance", label: "Burner balance covers its reviewed funding target", ok: balanceReady, detail: `balance=${recipientBalanceWei} required=${transaction.fundingValueWei} wei` },
  ];

  const verification: ConnectedHolderFundingVerification = {
    schemaVersion: "compas.connected-holder-funding-verification.v1",
    transactionId: transaction.id,
    hash: input.submission.hash,
    verified: checks.every((check) => check.ok),
    recipientBalanceWei,
    checks,
  };
  TRUSTED_FUNDING_VERIFICATIONS.set(verification, {
    plan: input.plan,
    planReviewKey: fundingReviewKey(input.plan),
    transactionId: transaction.id,
    hash: input.submission.hash,
    verificationKey: fundingVerificationKey(verification)!,
  });
  return verification;
}

function fundingReviewKey(plan: BurnerFundingPlan): string {
  return canonicalFundingKey(plan);
}

function assertFundingTransactionRequestsMatchPlan(plan: BurnerFundingPlan): void {
  for (const transaction of plan.transactions) {
    const requestKeys = Object.keys(transaction.request).sort().join(",");
    if (
      requestKeys !== "from,to,value" ||
      !sameAddress(transaction.from, plan.source.address) ||
      !sameAddress(transaction.request.from, transaction.from) ||
      !sameAddress(transaction.request.to, transaction.to) ||
      transaction.chainId !== plan.chain.chainId ||
      transaction.request.value.toLowerCase() !== toRpcQuantity(transaction.fundingValueWei)
    ) {
      throw new Error(`Funding transaction request does not match the reviewed plan: ${transaction.id}.`);
    }
  }
}

function fundingPreflightKey(preflight: ConnectedHolderFundingPreflight): string {
  return canonicalFundingKey(preflight);
}

function canonicalFundingKey(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => (
    typeof entry === "bigint" ? ["compas.bigint", entry.toString()] : entry
  ));
}

function fundingVerificationKey(verification: Partial<ConnectedHolderFundingVerification>): string | null {
  if (
    verification.schemaVersion !== "compas.connected-holder-funding-verification.v1" ||
    typeof verification.transactionId !== "string" ||
    typeof verification.hash !== "string" ||
    typeof verification.verified !== "boolean" ||
    typeof verification.recipientBalanceWei !== "bigint" ||
    !Array.isArray(verification.checks)
  ) return null;

  const checkKeys = verification.checks.map((check) => {
    if (
      !check ||
      !["receipt", "transaction", "balance"].includes(check.id) ||
      typeof check.label !== "string" ||
      typeof check.ok !== "boolean" ||
      typeof check.detail !== "string"
    ) return null;
    return [check.id, check.label, check.ok, check.detail].join(":");
  });
  if (checkKeys.some((key) => key === null)) return null;

  return canonicalFundingKey({
    schemaVersion: verification.schemaVersion,
    transactionId: verification.transactionId,
    hash: verification.hash.toLowerCase(),
    verified: verification.verified,
    recipientBalanceWei: verification.recipientBalanceWei,
    checks: verification.checks.map((check) => ({
      id: check.id,
      label: check.label,
      ok: check.ok,
      detail: check.detail,
    })),
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sameAddress(value: unknown, expected: string): boolean {
  return typeof value === "string" && value.toLowerCase() === expected.toLowerCase();
}

function sameHex(value: unknown, expected: string): boolean {
  return typeof value === "string" && value.toLowerCase() === expected.toLowerCase();
}

function parseRpcQuantity(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function toRpcQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}
