import {
  browserChainConfig,
  explorerTxUrl,
  type BrowserMintPlan,
  type BrowserPreparedMint,
  type GuidedMintReceipt,
} from "./browser-broadcast";

export const GUIDED_HOLDER_RECOVERY_STORAGE_KEY = "compas-guided-holder-recovery-v1";

export type GuidedHolderRecoveryJournal = {
  schemaVersion: "compas.guided-holder-recovery.v1";
  updatedAt: string;
  planBinding: string;
  expectedTransactionCount: number;
  chain: {
    key: "ethereum" | "base";
    chainId: number;
    name: string;
    explorer: string;
  };
  collection: { address: string; name: string };
  recipient: string;
  burnerAddresses: string[];
  mintTransactions: Array<{
    id: string;
    binding: string;
    hash: string;
    walletAlias: string;
    walletAddress: string;
    recipientMode: "holder";
    recipientAddress: string;
    stageId: string;
    stageLabel: string;
    quantity: number;
    request: {
      to: string;
      data: string;
      valueWei: string;
      gasLimit?: string;
      maxFeePerGasWei?: string;
    };
  }>;
  receipts: GuidedMintReceipt[];
  fundingTransactions: Array<{ transactionId: string; hash: string }>;
};

type StorageReader = { getItem(key: string): string | null };
type StorageWriter = { setItem(key: string, value: string): void };

export function buildGuidedHolderRecoveryJournal(input: {
  plan: BrowserMintPlan;
  collection: { address: string; name: string };
  recipient: string;
  transactions: readonly BrowserPreparedMint[];
  receipts: readonly GuidedMintReceipt[];
  fundingSubmissions: readonly { transactionId: string; hash: string }[];
  updatedAt?: string;
}): GuidedHolderRecoveryJournal {
  assertOpaqueBinding(input.plan.binding);
  assertAddress(input.collection.address, "collection");
  assertAddress(input.recipient, "recipient");
  if (input.plan.chain.key !== "base" && input.plan.chain.key !== "ethereum") {
    throw new Error("Guided recovery supports only Base and Ethereum plans.");
  }
  const mintTransactions = input.transactions
    .filter((transaction) => Boolean(transaction.hash && isHash(transaction.hash)))
    .map((transaction) => {
      if (transaction.binding !== input.plan.binding) throw new Error("Mint transaction binding does not match the guided plan binding.");
      if (transaction.recipientMode !== "holder" || !sameAddress(transaction.recipientAddress, input.recipient)) {
        throw new Error("Mint transaction recipient does not match the verified holder recovery recipient.");
      }
      return {
        id: transaction.id,
        binding: transaction.binding,
        hash: transaction.hash!,
        walletAlias: transaction.walletAlias,
        walletAddress: transaction.walletAddress,
        recipientMode: "holder" as const,
        recipientAddress: transaction.recipientAddress,
        stageId: transaction.stageId,
        stageLabel: transaction.stageLabel,
        quantity: transaction.quantity,
        request: {
          to: transaction.request.to,
          data: transaction.request.data,
          valueWei: transaction.request.value.toString(),
          gasLimit: transaction.request.gasLimit?.toString(),
          maxFeePerGasWei: transaction.request.maxFeePerGas?.toString(),
        },
      };
    });
  const submittedKeys = new Set(mintTransactions.map((transaction) => receiptKey(transaction)));
  const receipts = input.receipts
    .filter((receipt) => submittedKeys.has(receiptKey(receipt)))
    .map((receipt) => ({ ...receipt, tokenIds: receipt.tokenIds ? [...receipt.tokenIds] : undefined }));
  const fundingTransactions = input.fundingSubmissions.map((submission) => {
    if (!submission.transactionId || !isHash(submission.hash)) throw new Error("Funding recovery evidence requires a transaction id and valid hash.");
    return { transactionId: submission.transactionId, hash: submission.hash };
  });

  return parseGuidedHolderRecoveryJournal(JSON.stringify({
    schemaVersion: "compas.guided-holder-recovery.v1",
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    planBinding: input.plan.binding,
    expectedTransactionCount: input.plan.transactions.length,
    chain: {
      key: input.plan.chain.key,
      chainId: input.plan.chain.chainId,
      name: input.plan.chain.name,
      explorer: input.plan.chain.explorer,
    },
    collection: { address: input.collection.address, name: input.collection.name },
    recipient: input.recipient,
    burnerAddresses: [...new Set(input.plan.transactions.map((transaction) => transaction.walletAddress))],
    mintTransactions,
    receipts,
    fundingTransactions,
  }));
}

export function parseGuidedHolderRecoveryJournal(raw: string): GuidedHolderRecoveryJournal {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 250_000) throw new Error("Guided recovery journal is empty or oversized.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Guided recovery journal is not valid JSON.");
  }
  assertNoForbiddenKeys(parsed);
  const record = asRecord(parsed);
  if (!record || record.schemaVersion !== "compas.guided-holder-recovery.v1") throw new Error("Unsupported guided recovery journal schema.");
  const updatedAt = requireIsoDate(record.updatedAt);
  const planBinding = requireString(record.planBinding, "plan binding", 100);
  assertOpaqueBinding(planBinding);
  const expectedTransactionCount = requireSafePositiveInteger(record.expectedTransactionCount, "expected transaction count");
  const chain = asRecord(record.chain);
  if (!chain || (chain.key !== "base" && chain.key !== "ethereum")) throw new Error("Guided recovery chain is unsupported.");
  const chainId = requireSafePositiveInteger(chain.chainId, "chain id");
  const expectedChainId = chain.key === "base" ? 8453 : 1;
  if (chainId !== expectedChainId) throw new Error("Guided recovery chain id does not match its exact chain.");
  const collection = asRecord(record.collection);
  if (!collection) throw new Error("Guided recovery collection is missing.");
  const collectionAddress = requireAddress(collection.address, "collection");
  const collectionName = requirePublicString(collection.name, "collection name", 200);
  const recipient = requireAddress(record.recipient, "recipient");
  const burnerAddresses = requireArray(record.burnerAddresses, "burner addresses").map((value) => requireAddress(value, "burner"));
  const mintTransactions = requireArray(record.mintTransactions, "mint transactions").map((value) => parseMintTransaction(value, planBinding, recipient));
  const mintKeys = new Set(mintTransactions.map((transaction) => receiptKey(transaction)));
  const receipts = requireArray(record.receipts, "receipts").map((value) => parseReceipt(value, planBinding));
  if (receipts.some((receipt) => !mintKeys.has(receiptKey(receipt)))) throw new Error("Recovery receipt does not match a persisted mint transaction binding and hash.");
  const fundingTransactions = requireArray(record.fundingTransactions, "funding transactions").map((value) => {
    const row = asRecord(value);
    if (!row) throw new Error("Funding recovery row is invalid.");
    return {
      transactionId: requireString(row.transactionId, "funding transaction id", 200),
      hash: requireHash(row.hash, "funding transaction hash"),
    };
  });

  return {
    schemaVersion: "compas.guided-holder-recovery.v1",
    updatedAt,
    planBinding,
    expectedTransactionCount,
    chain: {
      key: chain.key,
      chainId,
      name: requireString(chain.name, "chain name", 100),
      explorer: requireHttpUrl(chain.explorer, "chain explorer"),
    },
    collection: { address: collectionAddress, name: collectionName },
    recipient,
    burnerAddresses: [...new Set(burnerAddresses)],
    mintTransactions,
    receipts,
    fundingTransactions,
  };
}

export function rehydrateGuidedRecoveryTransactions(journal: GuidedHolderRecoveryJournal): BrowserPreparedMint[] {
  const chain = browserChainConfig({ chainKey: journal.chain.key });
  if (!chain.ready || !chain.rpcUrl || chain.chainId !== journal.chain.chainId) throw new Error("A matching public RPC is unavailable for guided receipt recovery.");
  return journal.mintTransactions.map((transaction) => ({
    id: transaction.id,
    binding: transaction.binding,
    chain,
    rpcUrl: chain.rpcUrl!,
    walletAlias: transaction.walletAlias,
    walletAddress: transaction.walletAddress,
    recipientMode: "holder",
    recipientAddress: transaction.recipientAddress,
    stageId: transaction.stageId,
    stageLabel: transaction.stageLabel,
    quantity: transaction.quantity,
    request: {
      to: transaction.request.to,
      data: transaction.request.data,
      value: BigInt(transaction.request.valueWei),
      gasLimit: transaction.request.gasLimit === undefined ? undefined : BigInt(transaction.request.gasLimit),
      maxFeePerGas: transaction.request.maxFeePerGasWei === undefined ? undefined : BigInt(transaction.request.maxFeePerGasWei),
    },
    status: "broadcast",
    hash: transaction.hash,
    explorerUrl: explorerTxUrl(journal.chain.key, transaction.hash),
    broadcastAttempted: true,
  }));
}

export function rehydrateGuidedRecoveryBalancePlan(journal: GuidedHolderRecoveryJournal): BrowserMintPlan {
  const recovered = rehydrateGuidedRecoveryTransactions(journal);
  const chain = browserChainConfig({ chainKey: journal.chain.key });
  if (!chain.ready || !chain.rpcUrl || chain.chainId !== journal.chain.chainId) throw new Error("A matching public RPC is unavailable for guided balance recovery.");
  const transactions = journal.burnerAddresses.map((address, index) => {
    const submitted = recovered.find((transaction) => sameAddress(transaction.walletAddress, address));
    return submitted ?? {
      id: `recovery-balance-${index + 1}`,
      binding: journal.planBinding,
      chain,
      rpcUrl: chain.rpcUrl!,
      walletAlias: `Burner ${index + 1}`,
      walletAddress: address,
      recipientMode: "holder" as const,
      recipientAddress: journal.recipient,
      stageId: "recovery-balance",
      stageLabel: "Recovery balance",
      quantity: 0,
      request: { to: address, data: "0x", value: BigInt(0) },
      status: "prepared" as const,
    };
  });
  return {
    binding: journal.planBinding,
    chain,
    rpcUrl: chain.rpcUrl,
    totalValueWei: transactions.reduce((sum, transaction) => sum + transaction.request.value, BigInt(0)),
    transactions,
    warnings: [],
  };
}

export function readGuidedHolderRecoveryJournal(storage: StorageReader): GuidedHolderRecoveryJournal | null {
  const raw = storage.getItem(GUIDED_HOLDER_RECOVERY_STORAGE_KEY);
  return raw ? parseGuidedHolderRecoveryJournal(raw) : null;
}

export function writeGuidedHolderRecoveryJournal(storage: StorageWriter, journal: GuidedHolderRecoveryJournal): void {
  storage.setItem(GUIDED_HOLDER_RECOVERY_STORAGE_KEY, JSON.stringify(parseGuidedHolderRecoveryJournal(JSON.stringify(journal))));
}

function parseMintTransaction(value: unknown, planBinding: string, recipient: string): GuidedHolderRecoveryJournal["mintTransactions"][number] {
  const row = asRecord(value);
  if (!row || row.binding !== planBinding) throw new Error("Mint transaction binding does not match the recovery plan binding.");
  if (row.recipientMode !== "holder") throw new Error("Recovery mint recipient mode must remain holder-bound.");
  const recipientAddress = requireAddress(row.recipientAddress, "mint recipient");
  if (!sameAddress(recipientAddress, recipient)) throw new Error("Recovery mint recipient does not match the verified holder.");
  const request = asRecord(row.request);
  if (!request) throw new Error("Recovery mint request is missing.");
  return {
    id: requireString(row.id, "mint transaction id", 200),
    binding: planBinding,
    hash: requireHash(row.hash, "mint transaction hash"),
    walletAlias: requirePublicString(row.walletAlias, "burner alias", 200),
    walletAddress: requireAddress(row.walletAddress, "burner address"),
    recipientMode: "holder",
    recipientAddress,
    stageId: requireString(row.stageId, "stage id", 200),
    stageLabel: requirePublicString(row.stageLabel, "stage label", 200),
    quantity: requireSafePositiveInteger(row.quantity, "mint quantity"),
    request: {
      to: requireAddress(request.to, "mint target"),
      data: requireHex(request.data, "mint calldata"),
      valueWei: requireUnsignedIntegerString(request.valueWei, "mint value"),
      gasLimit: optionalUnsignedIntegerString(request.gasLimit, "gas limit"),
      maxFeePerGasWei: optionalUnsignedIntegerString(request.maxFeePerGasWei, "maximum fee per gas"),
    },
  };
}

function parseReceipt(value: unknown, planBinding: string): GuidedMintReceipt {
  const row = asRecord(value);
  if (!row || row.binding !== planBinding) throw new Error("Receipt binding does not match the recovery plan binding.");
  const statuses = ["Submitted", "Confirming", "Unknown", "Confirmed", "Failed"];
  if (typeof row.status !== "string" || !statuses.includes(row.status)) throw new Error("Recovery receipt status is invalid.");
  const confirmations = typeof row.confirmations === "number" && Number.isSafeInteger(row.confirmations) && row.confirmations >= 0 ? row.confirmations : null;
  if (confirmations === null) throw new Error("Recovery receipt confirmations are invalid.");
  return {
    transactionId: requireString(row.transactionId, "receipt transaction id", 200),
    binding: planBinding,
    hash: requireHash(row.hash, "receipt hash"),
    status: row.status as GuidedMintReceipt["status"],
    confirmations,
    verifiedRecipient: row.verifiedRecipient === undefined ? undefined : requireAddress(row.verifiedRecipient, "verified recipient"),
    tokenIds: row.tokenIds === undefined ? undefined : requireArray(row.tokenIds, "token ids").map((tokenId) => requireUnsignedIntegerString(tokenId, "token id")),
    error: row.error === undefined ? undefined : requirePublicString(row.error, "receipt error", 2_000),
  };
}

export function assertNoForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, nested] of Object.entries(record)) {
    if (/private.?key|raw.?signed|signed.?transaction|seed|mnemonic/i.test(key)) throw new Error(`Guided recovery journal contains forbidden secret field: ${key}.`);
    assertNoForbiddenKeys(nested);
  }
}

function receiptKey(value: { transactionId?: string; binding: string; hash?: string }): string {
  return `${value.binding}:${value.transactionId ?? ""}:${value.hash?.toLowerCase() ?? ""}`;
}
function assertOpaqueBinding(value: string): void { if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("Guided recovery plan binding must be an opaque cryptographic hash."); }
function sameAddress(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase(); }
function isHash(value: string): boolean { return /^0x[0-9a-fA-F]{64}$/.test(value); }
function assertAddress(value: unknown, label: string): asserts value is string { requireAddress(value, label); }
function requireAddress(value: unknown, label: string): string { const text = requireString(value, label, 42); if (!/^0x[0-9a-fA-F]{40}$/.test(text)) throw new Error(`${label} must be an EVM address.`); return text; }
function requireHash(value: unknown, label: string): string { const text = requireString(value, label, 66); if (!isHash(text)) throw new Error(`${label} must be a transaction hash.`); return text; }
function requireHex(value: unknown, label: string): string { const text = requireString(value, label, 100_000); if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(text)) throw new Error(`${label} must be even-length hex.`); return text; }
function requireUnsignedIntegerString(value: unknown, label: string): string { const text = requireString(value, label, 100); if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`${label} must be an unsigned integer string.`); return text; }
function optionalUnsignedIntegerString(value: unknown, label: string): string | undefined { return value === undefined ? undefined : requireUnsignedIntegerString(value, label); }
function requireSafePositiveInteger(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`); return value; }
function requireString(value: unknown, label: string, max: number): string { if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error(`${label} is invalid.`); return value; }
function requirePublicString(value: unknown, label: string, max: number): string {
  const text = requireString(value, label, max);
  if (containsSecretShapedValue(text)) throw new Error(`${label} contains a secret-shaped value.`);
  return text;
}
export function containsSecretShapedValue(value: string): boolean {
  return /(?:^|[^0-9a-fA-F])0x[0-9a-fA-F]{64}(?:$|[^0-9a-fA-F])/.test(value) || /(?:^|[^0-9a-fA-F])[0-9a-fA-F]{64}(?:$|[^0-9a-fA-F])/.test(value);
}
function requireArray(value: unknown, label: string): unknown[] { if (!Array.isArray(value) || value.length > 1_000) throw new Error(`${label} must be a bounded array.`); return value; }
function requireIsoDate(value: unknown): string { const text = requireString(value, "updated at", 100); if (!Number.isFinite(Date.parse(text))) throw new Error("Guided recovery updatedAt is invalid."); return text; }
function requireHttpUrl(value: unknown, label: string): string { const text = requireString(value, label, 2_000); let url: URL; try { url = new URL(text); } catch { throw new Error(`${label} must be a URL.`); } if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${label} must use HTTP(S).`); return text; }
function asRecord(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
