import assert from "node:assert/strict";
import test from "node:test";

import { buildBrowserMintPlan, type BrowserReceiptProviderLike, type UnlockedLaunchVault } from "./browser-broadcast";
import { buildGuidedHolderRecoveryJournal } from "./guided-holder-recovery";
import type { LaunchVaultPublicWallet } from "./encrypted-launch-vault";
import {
  RECOVER_FUNDS_SCAN_STORAGE_KEY,
  VAULT_SWEEP_REMINDER_HOURS,
  assessVaultSweepReminder,
  collectKnownBurners,
  parseStoredRecoverFundsScan,
  readStoredRecoverFundsScan,
  scanKnownBurnerResidualBalances,
  storedScanResidualWei,
  toStoredRecoverFundsScan,
  writeStoredRecoverFundsScan,
} from "./recover-funds";

const PRIVATE_KEY = `0x${"1".repeat(64)}`;
const HOLDER = "0x3333333333333333333333333333333333333333";
const COLLECTION = "0x1111111111111111111111111111111111111111";
const VAULT_BURNER = "0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A";
const JOURNAL_ONLY_BURNER = "0x4444444444444444444444444444444444444444";
const HASH = `0x${"a".repeat(64)}`;

function vaultWallet(address: string, label: string, chain: "ETH" | "Base"): LaunchVaultPublicWallet {
  return { id: `vault-1-${address.slice(2, 8)}`, label, chain, address, createdAt: 1_756_000_000_000 };
}

function journalFor(burner: string) {
  const unlocked: UnlockedLaunchVault = {
    status: "unlocked",
    unlockedAt: "2026-08-25T00:00:00.000Z",
    wallets: [{ alias: "Burner 1", address: burner, chain: "Base", privateKey: PRIVATE_KEY }],
  };
  const plan = buildBrowserMintPlan({
    chainKey: "base",
    collectionAddress: COLLECTION,
    stages: [{ id: "public", label: "Public", source: "onchain-seadrop", quantity: 1, priceEth: "0.05", feeRecipient: "0x2222222222222222222222222222222222222222" }],
    walletCount: 1,
    vault: unlocked,
    recipientMode: "holder",
    holderRecipientAddress: HOLDER,
    maxTotalValueWei: BigInt("50000000000000000"),
    gasLimit: BigInt(250_000),
    maxFeePerGasWei: BigInt(80_000_000),
  });
  const submitted = { ...plan.transactions[0], status: "broadcast" as const, hash: HASH, broadcastAttempted: true };
  const journal = buildGuidedHolderRecoveryJournal({
    plan,
    collection: { address: COLLECTION, name: "Guided drop" },
    recipient: HOLDER,
    transactions: [submitted],
    receipts: [],
    fundingSubmissions: [],
    updatedAt: "2026-08-25T00:00:00.000Z",
  });
  return { ...journal, burnerAddresses: [...journal.burnerAddresses, JOURNAL_ONLY_BURNER] };
}

function fakeProvider(input: { chainId?: bigint; balances?: Record<string, bigint>; failBalanceFor?: string[] }): BrowserReceiptProviderLike {
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

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) ?? null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
}

test("known burners merge encrypted Vault wallets and journal addresses for one exact chain, deduped", () => {
  const journal = journalFor(VAULT_BURNER);
  const burners = collectKnownBurners({
    chainKey: "base",
    vaultWallets: [
      vaultWallet(VAULT_BURNER, "Burner 1", "Base"),
      vaultWallet("0x5555555555555555555555555555555555555555", "Burner ETH", "ETH"),
    ],
    journal,
  });
  assert.equal(burners.length, 2);
  const vaultAndJournal = burners.find((burner) => burner.address.toLowerCase() === VAULT_BURNER.toLowerCase());
  assert.equal(vaultAndJournal?.source, "vault+journal");
  const journalOnly = burners.find((burner) => burner.address.toLowerCase() === JOURNAL_ONLY_BURNER.toLowerCase());
  assert.equal(journalOnly?.source, "journal");
  // ETH-chain vault wallet does not leak into a Base scan.
  assert.equal(burners.some((burner) => burner.address === "0x5555555555555555555555555555555555555555"), false);
});

test("known burners ignore a journal from a different chain", () => {
  const journal = journalFor(VAULT_BURNER);
  const burners = collectKnownBurners({
    chainKey: "ethereum",
    vaultWallets: [vaultWallet("0x5555555555555555555555555555555555555555", "Burner ETH", "ETH")],
    journal,
  });
  assert.equal(burners.length, 1);
  assert.equal(burners[0].source, "vault");
});

test("residual scan reads exact chain balances and classifies zero, nonzero, and unknown burners", async () => {
  const residual = BigInt("70000000000000");
  const burners = collectKnownBurners({
    chainKey: "base",
    vaultWallets: [vaultWallet(VAULT_BURNER, "Burner 1", "Base")],
    journal: journalFor(VAULT_BURNER),
  });
  const scan = await scanKnownBurnerResidualBalances({
    chainKey: "base",
    burners,
    recipient: HOLDER,
    provider: fakeProvider({ balances: { [VAULT_BURNER.toLowerCase()]: residual }, failBalanceFor: [JOURNAL_ONLY_BURNER] }),
    now: () => "2026-08-30T00:00:00.000Z",
  });
  assert.equal(scan.chain.chainId, 8453);
  assert.equal(scan.recipient, HOLDER);
  assert.equal(scan.hasResidual, true);
  assert.equal(scan.hasUnknown, true);
  assert.equal(scan.totalResidualWei, residual);
  const nonzero = scan.burners.find((burner) => burner.address.toLowerCase() === VAULT_BURNER.toLowerCase());
  assert.equal(nonzero?.status, "nonzero");
  assert.equal(nonzero?.balanceWei, residual);
  const unknown = scan.burners.find((burner) => burner.address.toLowerCase() === JOURNAL_ONLY_BURNER.toLowerCase());
  assert.equal(unknown?.status, "unknown");
  assert.equal(unknown?.balanceWei, null);
});

test("residual scan rejects a wrong-chain RPC instead of trusting its zero balances", async () => {
  const burners = collectKnownBurners({ chainKey: "base", vaultWallets: [vaultWallet(VAULT_BURNER, "Burner 1", "Base")] });
  await assert.rejects(
    scanKnownBurnerResidualBalances({ chainKey: "base", burners, provider: fakeProvider({ chainId: BigInt(1) }) }),
    /does not match the exact/,
  );
});

test("residual scan requires at least one known burner", async () => {
  await assert.rejects(
    scanKnownBurnerResidualBalances({ chainKey: "base", burners: [], provider: fakeProvider({}) }),
    /No known burners/,
  );
});

test("stored scan roundtrip persists only public secret-free evidence", async () => {
  const burners = collectKnownBurners({ chainKey: "base", vaultWallets: [vaultWallet(VAULT_BURNER, "Burner 1", "Base")] });
  const scan = await scanKnownBurnerResidualBalances({
    chainKey: "base",
    burners,
    recipient: HOLDER,
    provider: fakeProvider({ balances: { [VAULT_BURNER.toLowerCase()]: BigInt(42) } }),
    now: () => "2026-08-30T00:00:00.000Z",
  });
  const storage = new MemoryStorage();
  const stored = writeStoredRecoverFundsScan(storage, scan);
  assert.equal(storedScanResidualWei(stored), BigInt(42));
  const raw = storage.getItem(RECOVER_FUNDS_SCAN_STORAGE_KEY);
  assert.ok(raw);
  assert.equal(/privateKey|mnemonic|seed|signedTransaction|passphrase/i.test(raw!), false);
  const restored = readStoredRecoverFundsScan(storage);
  assert.deepEqual(restored, stored);
  assert.equal(restored!.burners[0].balanceWei, "42");
});

test("stored scan parser rejects secret-shaped fields and values", () => {
  const stored = toStoredRecoverFundsScan({
    scannedAt: "2026-08-30T00:00:00.000Z",
    chain: { key: "base", chainId: 8453, name: "Base", explorer: "https://basescan.org" },
    recipient: null,
    burners: [{ address: VAULT_BURNER, label: "Burner 1", source: "vault", balanceWei: null, status: "unknown" }],
    totalResidualWei: BigInt(0),
    hasResidual: false,
    hasUnknown: true,
  });
  assert.throws(() => parseStoredRecoverFundsScan(JSON.stringify({ ...stored, privateKey: `0x${"9".repeat(64)}` })), /forbidden secret field/);
  const smuggled = { ...stored, burners: [{ ...stored.burners[0], label: `Burner 0x${"9".repeat(64)}` }] };
  assert.throws(() => parseStoredRecoverFundsScan(JSON.stringify(smuggled)), /secret-shaped/);
  assert.throws(() => parseStoredRecoverFundsScan(JSON.stringify({ ...stored, chainId: 1 })), /chain id/);
  assert.throws(() => parseStoredRecoverFundsScan("not json"), /not valid JSON/);
});

test("vault sweep reminder fires only for residual balances with no activity beyond 24h", async () => {
  const burners = collectKnownBurners({ chainKey: "base", vaultWallets: [vaultWallet(VAULT_BURNER, "Burner 1", "Base")] });
  const scannedAt = "2026-08-28T00:00:00.000Z";
  const residualScan = toStoredRecoverFundsScan(await scanKnownBurnerResidualBalances({
    chainKey: "base",
    burners,
    provider: fakeProvider({ balances: { [VAULT_BURNER.toLowerCase()]: BigInt("5000000000000000") } }),
    now: () => scannedAt,
  }));
  const scannedMs = Date.parse(scannedAt);

  const stale = assessVaultSweepReminder({ scan: residualScan, now: scannedMs + (VAULT_SWEEP_REMINDER_HOURS + 2) * 3_600_000 });
  assert.equal(stale.sweepPending, true);
  assert.equal(stale.residualWei, BigInt("5000000000000000"));
  assert.ok(stale.reason.includes("Sweep pending"));

  const recent = assessVaultSweepReminder({ scan: residualScan, now: scannedMs + 3_600_000 });
  assert.equal(recent.sweepPending, false);

  const recentActivity = assessVaultSweepReminder({
    scan: residualScan,
    lastActivityAt: new Date(scannedMs + 30 * 3_600_000).toISOString(),
    now: scannedMs + 31 * 3_600_000,
  });
  assert.equal(recentActivity.sweepPending, false);

  const zeroScan = toStoredRecoverFundsScan(await scanKnownBurnerResidualBalances({
    chainKey: "base",
    burners,
    provider: fakeProvider({ balances: { [VAULT_BURNER.toLowerCase()]: BigInt(0) } }),
    now: () => scannedAt,
  }));
  const swept = assessVaultSweepReminder({ scan: zeroScan, now: scannedMs + 100 * 3_600_000 });
  assert.equal(swept.sweepPending, false);

  const noScan = assessVaultSweepReminder({ scan: null });
  assert.equal(noScan.sweepPending, false);
});
