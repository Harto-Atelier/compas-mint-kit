import { JsonRpcProvider } from "ethers";

import {
  browserChainConfig,
  type BrowserReceiptProviderLike,
} from "./browser-broadcast";
import type { LaunchVaultPublicWallet } from "./encrypted-launch-vault";
import type { GuidedHolderRecoveryJournal } from "./guided-holder-recovery";

/**
 * Recover funds: read-only residual balance scan across every known burner
 * (encrypted Vault addresses + recovery journal addresses) with a guided,
 * manual, holder-signed sweep path. Nothing here signs, sends, sweeps, or
 * retries transactions, and no private material is ever read or persisted.
 */

export const RECOVER_FUNDS_SCAN_STORAGE_KEY = "compas-recover-funds-scan-v1";
export const VAULT_SWEEP_REMINDER_HOURS = 24;

export type RecoverFundsChainKey = "ethereum" | "base";
export type KnownBurnerSource = "vault" | "journal" | "vault+journal";

export type KnownBurner = {
  address: string;
  label: string;
  source: KnownBurnerSource;
};

export type RecoverFundsBurnerStatus = "zero" | "nonzero" | "unknown";

export type RecoverFundsBurner = KnownBurner & {
  balanceWei: bigint | null;
  status: RecoverFundsBurnerStatus;
};

export type RecoverFundsScanResult = {
  scannedAt: string;
  chain: { key: RecoverFundsChainKey; chainId: number; name: string; explorer: string };
  recipient: string | null;
  burners: RecoverFundsBurner[];
  totalResidualWei: bigint;
  hasResidual: boolean;
  hasUnknown: boolean;
};

export type StoredRecoverFundsScan = {
  schemaVersion: "compas.recover-funds-scan.v1";
  scannedAt: string;
  chainKey: RecoverFundsChainKey;
  chainId: number;
  recipient: string | null;
  burners: Array<{ address: string; label: string; source: KnownBurnerSource; balanceWei: string | null }>;
};

export type VaultSweepReminder = {
  sweepPending: boolean;
  residualWei: bigint;
  hoursSinceActivity: number | null;
  reason: string;
};

type StorageReader = { getItem(key: string): string | null };
type StorageWriter = { setItem(key: string, value: string): void };

/** Merge Vault public wallets and journal burner addresses for one exact chain, deduped by address. */
export function collectKnownBurners(input: {
  chainKey: RecoverFundsChainKey;
  vaultWallets?: readonly LaunchVaultPublicWallet[];
  journal?: GuidedHolderRecoveryJournal | null;
}): KnownBurner[] {
  const expectedVaultChain = input.chainKey === "base" ? "Base" : "ETH";
  const merged = new Map<string, KnownBurner>();
  for (const wallet of input.vaultWallets ?? []) {
    if (wallet.chain !== expectedVaultChain) continue;
    requireAddress(wallet.address, "vault burner");
    merged.set(wallet.address.toLowerCase(), {
      address: wallet.address,
      label: requirePublicLabel(wallet.label, "vault burner label"),
      source: "vault",
    });
  }
  if (input.journal && input.journal.chain.key === input.chainKey) {
    for (const address of input.journal.burnerAddresses) {
      requireAddress(address, "journal burner");
      const key = address.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        merged.set(key, { ...existing, source: "vault+journal" });
      } else {
        merged.set(key, { address, label: `Journal burner ${merged.size + 1}`, source: "journal" });
      }
    }
  }
  return [...merged.values()];
}

/** Read-only chain-bound residual balance scan. Wrong-chain RPC answers are rejected, never treated as zero. */
export async function scanKnownBurnerResidualBalances(input: {
  chainKey: RecoverFundsChainKey;
  burners: readonly KnownBurner[];
  recipient?: string | null;
  provider?: BrowserReceiptProviderLike;
  now?: () => string;
}): Promise<RecoverFundsScanResult> {
  if (input.chainKey !== "ethereum" && input.chainKey !== "base") {
    throw new Error("Recover funds supports only Ethereum and Base scans.");
  }
  if (input.burners.length === 0) {
    throw new Error("No known burners to scan. Unlock the Vault or complete a guided run first.");
  }
  const chain = browserChainConfig({ chainKey: input.chainKey });
  if (!chain.ready || !chain.rpcUrl) {
    throw new Error(`A public RPC is unavailable for ${input.chainKey} residual balance scans.`);
  }
  const rpc = input.provider ?? (new JsonRpcProvider(chain.rpcUrl) as unknown as BrowserReceiptProviderLike);
  const network = await rpc.getNetwork();
  if (BigInt(network.chainId) !== BigInt(chain.chainId)) {
    throw new Error(`Recover funds RPC chain ${network.chainId.toString()} does not match the exact ${chain.name} chain ${chain.chainId}. Zero balances from the wrong chain are not evidence.`);
  }
  const recipient = input.recipient ? requireAddress(input.recipient, "recovery recipient") : null;

  const seen = new Set<string>();
  const burners: RecoverFundsBurner[] = [];
  for (const burner of input.burners) {
    const key = requireAddress(burner.address, "burner").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let balanceWei: bigint | null;
    try {
      balanceWei = await rpc.getBalance(burner.address);
    } catch {
      balanceWei = null;
    }
    burners.push({
      ...burner,
      balanceWei,
      status: balanceWei === null ? "unknown" : balanceWei === BigInt(0) ? "zero" : "nonzero",
    });
  }
  const totalResidualWei = burners.reduce((sum, burner) => sum + (burner.balanceWei ?? BigInt(0)), BigInt(0));
  return {
    scannedAt: input.now ? input.now() : new Date().toISOString(),
    chain: { key: input.chainKey, chainId: chain.chainId, name: chain.name, explorer: chain.explorer },
    recipient,
    burners,
    totalResidualWei,
    hasResidual: burners.some((burner) => burner.status === "nonzero"),
    hasUnknown: burners.some((burner) => burner.status === "unknown"),
  };
}

export function toStoredRecoverFundsScan(scan: RecoverFundsScanResult): StoredRecoverFundsScan {
  return parseStoredRecoverFundsScan(JSON.stringify({
    schemaVersion: "compas.recover-funds-scan.v1",
    scannedAt: scan.scannedAt,
    chainKey: scan.chain.key,
    chainId: scan.chain.chainId,
    recipient: scan.recipient,
    burners: scan.burners.map((burner) => ({
      address: burner.address,
      label: burner.label,
      source: burner.source,
      balanceWei: burner.balanceWei === null ? null : burner.balanceWei.toString(),
    })),
  }));
}

export function parseStoredRecoverFundsScan(raw: string): StoredRecoverFundsScan {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 250_000) throw new Error("Stored recover-funds scan is empty or oversized.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Stored recover-funds scan is not valid JSON.");
  }
  const record = asRecord(parsed);
  if (!record || record.schemaVersion !== "compas.recover-funds-scan.v1") throw new Error("Unsupported recover-funds scan schema.");
  assertNoForbiddenKeys(parsed);
  const chainKey = record.chainKey;
  if (chainKey !== "ethereum" && chainKey !== "base") throw new Error("Recover-funds scan chain is unsupported.");
  const expectedChainId = chainKey === "base" ? 8453 : 1;
  if (record.chainId !== expectedChainId) throw new Error("Recover-funds scan chain id does not match its exact chain.");
  const scannedAt = requireIsoDate(record.scannedAt);
  const recipient = record.recipient === null ? null : requireAddress(record.recipient, "recovery recipient");
  if (!Array.isArray(record.burners) || record.burners.length === 0 || record.burners.length > 1_000) throw new Error("Recover-funds scan burners must be a bounded non-empty array.");
  const burners = record.burners.map((value) => {
    const row = asRecord(value);
    if (!row) throw new Error("Recover-funds burner row is invalid.");
    const source = row.source;
    if (source !== "vault" && source !== "journal" && source !== "vault+journal") throw new Error("Recover-funds burner source is invalid.");
    const balanceWei = row.balanceWei === null ? null : requireUnsignedIntegerString(row.balanceWei, "burner balance");
    return {
      address: requireAddress(row.address, "burner"),
      label: requirePublicLabel(requireString(row.label, "burner label", 200), "burner label"),
      source: source as KnownBurnerSource,
      balanceWei,
    };
  });
  return { schemaVersion: "compas.recover-funds-scan.v1", scannedAt, chainKey, chainId: expectedChainId, recipient, burners };
}

export function readStoredRecoverFundsScan(storage: StorageReader): StoredRecoverFundsScan | null {
  const raw = storage.getItem(RECOVER_FUNDS_SCAN_STORAGE_KEY);
  if (!raw) return null;
  return parseStoredRecoverFundsScan(raw);
}

export function writeStoredRecoverFundsScan(storage: StorageWriter, scan: RecoverFundsScanResult): StoredRecoverFundsScan {
  const stored = toStoredRecoverFundsScan(scan);
  storage.setItem(RECOVER_FUNDS_SCAN_STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

export function storedScanResidualWei(scan: StoredRecoverFundsScan): bigint {
  return scan.burners.reduce((sum, burner) => sum + (burner.balanceWei === null ? BigInt(0) : BigInt(burner.balanceWei)), BigInt(0));
}

/**
 * Vault stale-balance reminder: if known burners still hold balance and there
 * has been no recorded activity for more than 24 hours, surface a visible
 * "sweep pending" banner. Advisory only — nothing is ever swept automatically.
 */
export function assessVaultSweepReminder(input: {
  scan: StoredRecoverFundsScan | null;
  lastActivityAt?: string | null;
  now?: number;
}): VaultSweepReminder {
  if (!input.scan) {
    return { sweepPending: false, residualWei: BigInt(0), hoursSinceActivity: null, reason: "No residual balance scan has been recorded yet." };
  }
  const residualWei = storedScanResidualWei(input.scan);
  const referenceRaw = input.lastActivityAt ?? input.scan.scannedAt;
  const referenceMs = Date.parse(referenceRaw);
  if (!Number.isFinite(referenceMs)) {
    return { sweepPending: false, residualWei, hoursSinceActivity: null, reason: "Activity timestamps are invalid; re-run the residual scan." };
  }
  const nowMs = input.now ?? Date.now();
  const hoursSinceActivity = Math.max(0, (nowMs - referenceMs) / 3_600_000);
  if (residualWei === BigInt(0)) {
    return { sweepPending: false, residualWei, hoursSinceActivity, reason: "The last scan found no residual burner balance." };
  }
  if (hoursSinceActivity <= VAULT_SWEEP_REMINDER_HOURS) {
    return { sweepPending: false, residualWei, hoursSinceActivity, reason: "Residual balance exists but activity is recent; keep the guided run or recovery flow moving." };
  }
  return {
    sweepPending: true,
    residualWei,
    hoursSinceActivity,
    reason: `Known burners still hold ${residualWei.toString()} wei with no activity for over ${VAULT_SWEEP_REMINDER_HOURS}h. Sweep pending: recover funds to the verified holder through the manual exact sweep flow.`,
  };
}

function assertNoForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [key, nested] of Object.entries(record)) {
    if (/private.?key|raw.?signed|signed.?transaction|seed|mnemonic|passphrase/i.test(key)) throw new Error(`Recover-funds scan contains forbidden secret field: ${key}.`);
    assertNoForbiddenKeys(nested);
  }
}

function requireAddress(value: unknown, label: string): string {
  const text = requireString(value, label, 42);
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) throw new Error(`${label} must be an EVM address.`);
  return text;
}
function requirePublicLabel(value: string, label: string): string {
  if (/(?:^|[^0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?:$|[^0-9a-fA-F])/.test(value)) throw new Error(`${label} contains a secret-shaped value.`);
  return value;
}
function requireUnsignedIntegerString(value: unknown, label: string): string {
  const text = requireString(value, label, 100);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`${label} must be an unsigned integer string.`);
  return text;
}
function requireString(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error(`${label} is invalid.`);
  return value;
}
function requireIsoDate(value: unknown): string {
  const text = requireString(value, "scanned at", 100);
  if (!Number.isFinite(Date.parse(text))) throw new Error("Recover-funds scannedAt is invalid.");
  return text;
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
