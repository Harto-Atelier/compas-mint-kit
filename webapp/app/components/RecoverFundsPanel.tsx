"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEther } from "ethers";

import { maskVaultAddress, type LaunchVaultPublicWallet } from "@/lib/encrypted-launch-vault";
import type { GuidedHolderRecoveryJournal } from "@/lib/guided-holder-recovery";
import {
  RECOVER_FUNDS_SCAN_STORAGE_KEY,
  assessVaultSweepReminder,
  collectKnownBurners,
  readStoredRecoverFundsScan,
  scanKnownBurnerResidualBalances,
  writeStoredRecoverFundsScan,
  type RecoverFundsChainKey,
  type RecoverFundsScanResult,
  type StoredRecoverFundsScan,
} from "@/lib/recover-funds";

type RecoverFundsPanelProps = {
  holderAddress: string | null;
  vaultWallets: readonly LaunchVaultPublicWallet[];
  journal: GuidedHolderRecoveryJournal | null;
  onOpenVault: () => void;
};

/**
 * Visible "Recover funds" entry for the app home/guide. Read-only residual
 * balance scan across every known burner (encrypted Vault + recovery journal)
 * with a guided manual sweep back to the verified holder wallet. Nothing here
 * signs, sends, sweeps, or retries transactions.
 */
export default function RecoverFundsPanel({ holderAddress, vaultWallets, journal, onOpenVault }: RecoverFundsPanelProps) {
  const [open, setOpen] = useState(false);
  const [chainKey, setChainKey] = useState<RecoverFundsChainKey>(journal?.chain.key ?? "base");
  const [scan, setScan] = useState<RecoverFundsScanResult | null>(null);
  const [storedScan, setStoredScan] = useState<StoredRecoverFundsScan | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return readStoredRecoverFundsScan(window.localStorage);
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== RECOVER_FUNDS_SCAN_STORAGE_KEY) return;
      try {
        setStoredScan(readStoredRecoverFundsScan(window.localStorage));
      } catch {
        setStoredScan(null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const sweepReminder = useMemo(() => {
    const journalMs = journal ? Date.parse(journal.updatedAt) : Number.NaN;
    const scanMs = storedScan ? Date.parse(storedScan.scannedAt) : Number.NaN;
    const lastActivityAt = Number.isFinite(journalMs) && (!Number.isFinite(scanMs) || journalMs > scanMs)
      ? journal!.updatedAt
      : null;
    return assessVaultSweepReminder({ scan: storedScan, lastActivityAt });
  }, [storedScan, journal]);

  const knownBurners = useMemo(
    () => collectKnownBurners({ chainKey, vaultWallets, journal }),
    [chainKey, vaultWallets, journal],
  );

  async function runScan() {
    setScanError(null);
    setBusy(true);
    try {
      const result = await scanKnownBurnerResidualBalances({
        chainKey,
        burners: knownBurners,
        recipient: holderAddress,
      });
      setScan(result);
      setStoredScan(writeStoredRecoverFundsScan(window.localStorage, result));
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "The residual balance scan failed and can be retried.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border-2 border-[color:var(--compas-accent)] bg-[color:var(--compas-card)] p-4">
      {sweepReminder.sweepPending ? (
        <p className="mb-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-3 text-sm font-black text-amber-900" role="alert">
          Sweep pending · Known burners still hold {formatEther(sweepReminder.residualWei)} ETH with no activity for over 24h. Recover funds to your verified holder wallet below. Nothing is swept automatically.
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[color:var(--compas-accent)]">Recover funds</p>
          <p className="mt-1 text-sm font-bold text-[color:var(--compas-muted)]">Scan known burners for leftover balances and sweep them back to your verified wallet. Read-only checks; you sign every sweep.</p>
        </div>
        <button type="button" onClick={() => setOpen((current) => !current)} className="shrink-0 rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)]">
          {open ? "Hide recovery" : "Recover funds"}
        </button>
      </div>
      {open ? (
        <div className="mt-4 grid gap-3">
          <div className="grid gap-2 sm:grid-cols-[150px_1fr_auto]">
            <select value={chainKey} onChange={(event) => setChainKey(event.target.value === "ethereum" ? "ethereum" : "base")} className="h-11 rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-card)] px-3 text-sm font-bold" aria-label="Recovery chain">
              <option value="base">Base</option>
              <option value="ethereum">Ethereum</option>
            </select>
            <p className="self-center text-xs font-bold text-[color:var(--compas-muted)]">{knownBurners.length} known burner(s) from the unlocked Vault and the recovery journal. Locked Vault wallets appear after unlock in step 02.</p>
            <button type="button" onClick={() => void runScan()} disabled={busy || knownBurners.length === 0} className="rounded-2xl border border-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent)] disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? "Scanning…" : "Scan residual balances"}
            </button>
          </div>
          {scanError ? <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{scanError}</p> : null}
          {scan ? (
            <div className="rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">Scan · {scan.chain.name} · {new Date(scan.scannedAt).toLocaleString()}</p>
              <p className="mt-2 text-sm font-black">{scan.hasResidual ? `${formatEther(scan.totalResidualWei)} ETH still sitting in burner wallets.` : scan.hasUnknown ? "Some balances could not be read. Retry before assuming they are empty." : "Every known burner is at zero. Nothing to recover."}</p>
              <div className="mt-3 grid gap-1.5">
                {scan.burners.map((burner) => (
                  <p key={burner.address} className="rounded-xl bg-[color:var(--compas-card)] p-2 font-mono text-xs font-bold">
                    {maskVaultAddress(burner.address)} · {burner.label} · {burner.source} · {burner.status === "unknown" ? "balance unknown" : `${formatEther(burner.balanceWei!)} ETH`}
                  </p>
                ))}
              </div>
              {scan.hasResidual || scan.hasUnknown ? (
                <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900">
                  <p className="text-xs font-black uppercase tracking-[0.14em]">Manual sweep to your verified wallet</p>
                  <p className="mt-2 text-xs font-bold">Recipient: {holderAddress ? maskVaultAddress(holderAddress) : "verify your holder wallet first"}. For each burner separately: re-read the exact balance and nonce, bind gas limit and maximum fee, set value to balance minus that maximum gas fee, simulate only to your verified holder wallet, consent for that burner, send, verify the receipt, then recheck the residual balance. You sign every sweep; nothing is automatic.</p>
                  <button type="button" onClick={onOpenVault} className="mt-3 w-full rounded-xl bg-amber-800 px-4 py-2 text-xs font-black text-white">Open encrypted Vault for manual sweep</button>
                </div>
              ) : null}
            </div>
          ) : storedScan ? (
            <p className="rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-3 text-xs font-bold text-[color:var(--compas-muted)]">Last recorded scan · {storedScan.chainId === 8453 ? "Base" : "Ethereum"} · {new Date(storedScan.scannedAt).toLocaleString()} · {storedScan.burners.length} burner(s). Run a fresh scan for current onchain balances.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
