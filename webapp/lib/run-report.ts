import { CHAINS, resolveChain } from "./chains";

export type RunReportStatus = "confirmed" | "pending" | "failed";

type JsonRecord = Record<string, unknown>;

export interface RunReportChain {
  key: string;
  name: string;
  chainId: number;
  explorer: string;
  nativeSymbol: string;
}

export interface RunReportCollection {
  name: string;
  address?: string;
  openseaUrl?: string;
  explorerUrl?: string;
}

export interface NormalizedRunTransaction {
  id: string;
  walletAlias: string;
  walletAddress?: string;
  stageId: string;
  stageLabel: string;
  quantity: number;
  status: RunReportStatus;
  txHash?: string;
  explorerUrl?: string;
  blockNumber?: number;
  gasUsed?: number;
  error?: string;
  rpcLabels: string[];
}

export interface RunStageSummary {
  stageId: string;
  stageLabel: string;
  confirmedMints: number;
  confirmedTx: number;
  pendingTx: number;
  failedTx: number;
  totalTx: number;
}

export interface RunReportAnalytics {
  totalTransactions: number;
  confirmedTransactions: number;
  pendingTransactions: number;
  failedTransactions: number;
  mintedQuantity: number;
  totalQuantity: number;
  totalGasUsed: number;
  averageGasUsed: number | null;
  confirmationRate: number;
  failureRate: number;
  uniqueWallets: number;
  stagesTouched: number;
}

export interface NormalizedRunReport {
  schemaVersion: string;
  sourceName: string;
  generatedAt?: string;
  importedAt: string;
  collection: RunReportCollection;
  chain: RunReportChain;
  transactions: NormalizedRunTransaction[];
  stageSummaries: RunStageSummary[];
  analytics: RunReportAnalytics;
  warnings: string[];
}

const SECRET_KEY_RE = /(?:private|secret|mnemonic|seed|signedtx|signedtransaction|rawtx|rawtransaction|signature|walletkey)/i;
const PRIVATE_KEY_LIKE_VALUE_RE = /(?:^|[\s,:'"=])(?:0x)?[a-fA-F0-9]{64}(?=$|[\s,:'"])/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

export function parseRunReportJson(rawJson: string, sourceName = "run-report.json", now = new Date()): NormalizedRunReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch (err) {
    throw new Error(`Run report is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return normalizeRunReport(parsed, { sourceName, importedAt: now.toISOString() });
}

export function normalizeRunReport(value: unknown, opts: { sourceName?: string; importedAt?: string } = {}): NormalizedRunReport {
  assertNoSecretFields(value);
  const root = expectRecord(value, "run report");
  const report = unwrapReport(root);
  const chain = inferChain(report, root);
  const collection = inferCollection(report, root, chain);
  const transactions = collectTransactionRows(report, root).map((row, index) => normalizeTransaction(row, index, chain));

  if (transactions.length === 0) {
    throw new Error("Run report does not contain transaction rows. Expected transactions/results/mints/wallets[].transactions.");
  }

  const stageSummaries = buildStageSummaries(transactions);
  const analytics = buildAnalytics(transactions, stageSummaries);
  const warnings = collectWarnings(report, root);

  return {
    schemaVersion: stringFrom(report.schemaVersion) ?? stringFrom(root.schemaVersion) ?? "unknown-run-report",
    sourceName: opts.sourceName ?? "run-report.json",
    generatedAt: normalizeOptionalDate(
      firstDefined(report.generatedAt, report.completedAt, report.createdAt, report.startedAt, root.generatedAt, root.completedAt, root.createdAt)
    ),
    importedAt: opts.importedAt ?? new Date().toISOString(),
    collection,
    chain,
    transactions,
    stageSummaries,
    analytics,
    warnings,
  };
}

function unwrapReport(root: JsonRecord): JsonRecord {
  const nested = firstRecord(root.runReport, root.report, root.result);
  return nested ?? root;
}

function inferChain(report: JsonRecord, root: JsonRecord): RunReportChain {
  const runConfig = firstRecord(report.runConfig, root.runConfig, report.config, root.config);
  const chainRecord = firstRecord(report.chain, root.chain, runConfig?.chain, firstRecord(runConfig?.collection)?.chain, report.collection && firstRecord(report.collection)?.chain);
  const rawKey = stringFrom(chainRecord?.key) ?? stringFrom(report.chainKey) ?? stringFrom(root.chainKey) ?? (typeof report.chain === "string" ? report.chain : undefined);
  const rawChainId = numberFrom(chainRecord?.chainId) ?? numberFrom(report.chainId) ?? numberFrom(root.chainId);
  const knownById = rawChainId ? CHAINS.find((chain) => chain.chainId === rawChainId) : undefined;
  const knownByKey = rawKey ? resolveChain(rawKey) : undefined;
  const fallback = knownById ?? knownByKey ?? resolveChain("base");

  return {
    key: stringFrom(chainRecord?.key) ?? fallback.key,
    name: stringFrom(chainRecord?.name) ?? fallback.name,
    chainId: rawChainId ?? fallback.chainId,
    explorer: trimTrailingSlash(stringFrom(chainRecord?.explorer) ?? stringFrom(chainRecord?.explorerUrl) ?? fallback.explorer),
    nativeSymbol: stringFrom(chainRecord?.nativeSymbol) ?? fallback.nativeSymbol,
  };
}

function inferCollection(report: JsonRecord, root: JsonRecord, chain: RunReportChain): RunReportCollection {
  const runConfig = firstRecord(report.runConfig, root.runConfig, report.config, root.config);
  const collection = firstRecord(report.collection, root.collection, runConfig?.collection);
  const address = stringFrom(collection?.address) ?? stringFrom(report.contract) ?? stringFrom(report.nftContract) ?? stringFrom(root.contract);
  return {
    name: stringFrom(collection?.name) ?? stringFrom(collection?.slug) ?? stringFrom(report.collectionName) ?? "CLI run report",
    address,
    openseaUrl: stringFrom(collection?.openseaUrl),
    explorerUrl: stringFrom(collection?.explorerUrl) ?? (address ? `${chain.explorer}/address/${address}` : undefined),
  };
}

function collectTransactionRows(report: JsonRecord, root: JsonRecord): JsonRecord[] {
  const rows: JsonRecord[] = [];
  for (const list of [report.transactions, report.transactionResults, report.results, report.mints, report.items, root.transactions, root.results]) {
    if (Array.isArray(list)) rows.push(...list.filter(isRecord));
  }

  for (const wallet of arrayOfRecords(report.wallets)) {
    const walletTransactions = firstArray(wallet.transactions, wallet.results, wallet.mints);
    if (!walletTransactions) continue;
    for (const tx of walletTransactions.filter(isRecord)) {
      rows.push({ ...wallet, ...tx, walletAlias: firstDefined(tx.walletAlias, tx.alias, wallet.alias, wallet.walletAlias, wallet.name), walletAddress: firstDefined(tx.walletAddress, tx.address, wallet.address, wallet.walletAddress) });
    }
  }

  for (const stage of arrayOfRecords(report.stages)) {
    const stageTransactions = firstArray(stage.transactions, stage.results, stage.mints);
    if (!stageTransactions) continue;
    for (const tx of stageTransactions.filter(isRecord)) {
      rows.push({ ...stage, ...tx, stageId: firstDefined(tx.stageId, tx.stage, stage.stageId, stage.id), stageLabel: firstDefined(tx.stageLabel, tx.stageName, stage.stageLabel, stage.label, stage.name) });
    }
  }

  return dedupeTransactions(rows);
}

function normalizeTransaction(row: JsonRecord, index: number, chain: RunReportChain): NormalizedRunTransaction {
  const receipt = firstRecord(row.receipt);
  const txHash = normalizeTxHash(firstDefined(row.txHash, row.hash, row.transactionHash, receipt?.transactionHash));
  const status = normalizeStatus(row, receipt, txHash);
  const quantity = positiveInteger(firstDefined(row.quantity, row.quantityPerWallet, row.mintedQuantity, row.minted, row.count), 1);
  const blockNumber = integerFrom(firstDefined(row.blockNumber, row.block, receipt?.blockNumber));
  const gasUsed = integerFrom(firstDefined(row.gasUsed, row.gas, receipt?.gasUsed));
  const stageId = stringFrom(firstDefined(row.stageId, row.stage, row.stageKey, row.phase)) ?? "public";
  const stageLabel = stringFrom(firstDefined(row.stageLabel, row.stageName, row.label, row.phaseLabel)) ?? titleCase(stageId);
  const walletAlias = stringFrom(firstDefined(row.walletAlias, row.alias, row.wallet, row.walletName, row.label)) ?? `wallet-${String(index + 1).padStart(2, "0")}`;
  const walletAddress = stringFrom(firstDefined(row.walletAddress, row.address, row.from));
  const explicitUrl = stringFrom(firstDefined(row.explorerUrl, row.txUrl, row.url, row.trackUrl));

  return {
    id: stringFrom(row.id) ?? txHash ?? `${walletAlias}-${stageId}-${index}`,
    walletAlias,
    walletAddress,
    stageId,
    stageLabel,
    quantity,
    status,
    txHash,
    explorerUrl: explicitUrl ?? (txHash ? `${chain.explorer}/tx/${txHash}` : undefined),
    blockNumber,
    gasUsed,
    error: stringFrom(firstDefined(row.error, row.reason, row.message, row.failureReason)),
    rpcLabels: collectRpcLabels(row),
  };
}

function normalizeStatus(row: JsonRecord, receipt: JsonRecord | undefined, txHash?: string): RunReportStatus {
  const receiptStatus = stringFrom(receipt?.status)?.toLowerCase();
  if (receiptStatus === "success" || receiptStatus === "confirmed" || receiptStatus === "0x1" || receiptStatus === "1") return "confirmed";
  if (receiptStatus === "reverted" || receiptStatus === "failed" || receiptStatus === "0x0" || receiptStatus === "0") return "failed";

  const raw = stringFrom(firstDefined(row.status, row.state, row.result, row.outcome))?.toLowerCase() ?? "";
  if (["confirmed", "success", "succeeded", "complete", "completed", "minted", "included"].includes(raw)) return "confirmed";
  if (["failed", "failure", "error", "rejected", "reverted", "dropped", "never-broadcast"].includes(raw)) return "failed";
  if (["pending", "submitted", "accepted", "broadcast", "broadcasted", "timeout", "timed-out", "dispatched"].includes(raw)) return "pending";
  if (stringFrom(firstDefined(row.error, row.reason, row.failureReason)) && !txHash) return "failed";
  return txHash ? "pending" : "failed";
}

function collectRpcLabels(row: JsonRecord): string[] {
  const rpcRows = firstArray(row.rpcResults, row.results, row.endpoints, row.rpcResponses) ?? [];
  return Array.from(
    new Set(
      rpcRows
        .filter(isRecord)
        .map((rpc) => stringFrom(firstDefined(rpc.label, rpc.name, rpc.url)))
        .filter((label): label is string => Boolean(label))
    )
  );
}

function buildStageSummaries(transactions: NormalizedRunTransaction[]): RunStageSummary[] {
  const summaries = new Map<string, RunStageSummary>();
  for (const tx of transactions) {
    const key = tx.stageId;
    const current = summaries.get(key) ?? {
      stageId: tx.stageId,
      stageLabel: tx.stageLabel,
      confirmedMints: 0,
      confirmedTx: 0,
      pendingTx: 0,
      failedTx: 0,
      totalTx: 0,
    };
    current.totalTx += 1;
    if (tx.status === "confirmed") {
      current.confirmedTx += 1;
      current.confirmedMints += tx.quantity;
    } else if (tx.status === "pending") {
      current.pendingTx += 1;
    } else {
      current.failedTx += 1;
    }
    summaries.set(key, current);
  }
  return Array.from(summaries.values()).sort((a, b) => a.stageLabel.localeCompare(b.stageLabel));
}

function buildAnalytics(transactions: NormalizedRunTransaction[], stageSummaries: RunStageSummary[]): RunReportAnalytics {
  const totalTransactions = transactions.length;
  const confirmedTransactions = transactions.filter((tx) => tx.status === "confirmed").length;
  const pendingTransactions = transactions.filter((tx) => tx.status === "pending").length;
  const failedTransactions = transactions.filter((tx) => tx.status === "failed").length;
  const totalGasUsed = transactions.reduce((sum, tx) => sum + (tx.gasUsed ?? 0), 0);
  const gasRows = transactions.filter((tx) => tx.gasUsed !== undefined).length;
  const uniqueWallets = new Set(transactions.map((tx) => tx.walletAddress ?? tx.walletAlias)).size;

  return {
    totalTransactions,
    confirmedTransactions,
    pendingTransactions,
    failedTransactions,
    mintedQuantity: transactions.reduce((sum, tx) => sum + (tx.status === "confirmed" ? tx.quantity : 0), 0),
    totalQuantity: transactions.reduce((sum, tx) => sum + tx.quantity, 0),
    totalGasUsed,
    averageGasUsed: gasRows > 0 ? Math.round(totalGasUsed / gasRows) : null,
    confirmationRate: totalTransactions > 0 ? confirmedTransactions / totalTransactions : 0,
    failureRate: totalTransactions > 0 ? failedTransactions / totalTransactions : 0,
    uniqueWallets,
    stagesTouched: stageSummaries.length,
  };
}

function collectWarnings(report: JsonRecord, root: JsonRecord): string[] {
  const values = [report.warnings, root.warnings, report.notes, root.notes]
    .flatMap((entry) => (Array.isArray(entry) ? entry : []))
    .map(String)
    .filter(Boolean);
  return Array.from(new Set(values));
}

function assertNoSecretFields(value: unknown, path = "$", seen = new WeakSet<object>()): void {
  if (typeof value === "string") {
    const key = path.split(".").at(-1)?.replace(/\[\d+\]$/, "") ?? "";
    const isHashField = ["txHash", "hash", "transactionHash", "blockHash"].includes(key);
    if (!isHashField && PRIVATE_KEY_LIKE_VALUE_RE.test(value)) throw new Error(`Secret-shaped value found at ${path}. Import tx hashes/receipts only, not keys or signed transactions.`);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretFields(item, `${path}[${index}]`, seen));
    return;
  }

  for (const [key, child] of Object.entries(value as JsonRecord)) {
    if (SECRET_KEY_RE.test(key)) throw new Error(`Secret-like field "${path}.${key}" is not supported by the web viewer.`);
    assertNoSecretFields(child, `${path}.${key}`, seen);
  }
}

function dedupeTransactions(rows: JsonRecord[]): JsonRecord[] {
  const seen = new Set<string>();
  const unique: JsonRecord[] = [];
  rows.forEach((row, index) => {
    const key = normalizeTxHash(firstDefined(row.txHash, row.hash, row.transactionHash)) ?? `${index}:${JSON.stringify(row).slice(0, 200)}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(row);
  });
  return unique;
}

function normalizeTxHash(value: unknown): string | undefined {
  const raw = stringFrom(value);
  if (!raw) return undefined;
  return TX_HASH_RE.test(raw) ? raw : raw;
}

function firstRecord(...values: unknown[]): JsonRecord | undefined {
  return values.find(isRecord);
}

function firstArray(...values: unknown[]): unknown[] | undefined {
  return values.find(Array.isArray);
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function expectRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberFrom(value: unknown): number | undefined {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function integerFrom(value: unknown): number | undefined {
  if (typeof value === "string" && value.startsWith("0x")) return Number.parseInt(value, 16);
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = integerFrom(value);
  return parsed !== undefined && parsed > 0 ? parsed : fallback;
}

function normalizeOptionalDate(value: unknown): string | undefined {
  const raw = stringFrom(value);
  if (!raw) return undefined;
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? raw : new Date(timestamp).toISOString();
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
