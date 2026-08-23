"use client";

import { FormEvent, useMemo, useState } from "react";
import { formatEther } from "ethers";
import {
  LAUNCH_VAULT_STORAGE_KEY,
  decryptLaunchVaultBackup,
  maskVaultAddress,
  parseEncryptedLaunchVaultBackup,
  type EncryptedLaunchVaultBackup,
  type LaunchVaultPayload,
} from "@/lib/encrypted-launch-vault";
import {
  broadcastPreparedBrowserMint,
  buildBrowserRunReport,
  buildBrowserGasStrategy,
  browserChainConfig,
  buildBrowserMintPlan,
  simulatePreparedBrowserMint,
  type BrowserBroadcastChainKey,
  type BrowserMintStageInput,
  type BrowserPreparedMint,
  type UnlockedLaunchVault,
} from "@/lib/browser-broadcast";
import type { CollectionCard, MintStage, StageKind } from "@/lib/mint-types";

const FIELD = "h-11 rounded-2xl border border-violet-100 bg-white px-3 text-sm font-bold text-slate-950 outline-none shadow-sm placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100";
const CHAINS: BrowserBroadcastChainKey[] = ["ethereum", "base", "robinhood"];

type BrowserBroadcastPanelProps = {
  collection: CollectionCard;
  stages: MintStage[];
  quantities: Record<StageKind, number>;
  walletCount: number;
};

export default function BrowserBroadcastPanel({ collection, quantities, stages, walletCount }: BrowserBroadcastPanelProps) {
  const [vault, setVault] = useState<LaunchVaultPayload | null>(null);
  const [encryptedBackup] = useState<EncryptedLaunchVaultBackup | null>(() => readStoredVaultBackup());
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [chainKey, setChainKey] = useState<BrowserBroadcastChainKey>(() => defaultChainKey(collection.chain.key));
  const [rpcUrl, setRpcUrl] = useState("");
  const [seaDropAddress, setSeaDropAddress] = useState("");
  const [transactions, setTransactions] = useState<BrowserPreparedMint[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastConsent, setBroadcastConsent] = useState(false);
  const [maxFeeGwei, setMaxFeeGwei] = useState(0.08);
  const [priorityFeeGwei, setPriorityFeeGwei] = useState(0.02);
  const [retryLimit, setRetryLimit] = useState(2);
  const [escalationPercent, setEscalationPercent] = useState(15);
  const [nonceMode, setNonceMode] = useState<"sequential" | "parallel">("sequential");

  const selectedStages = useMemo<BrowserMintStageInput[]>(
    () =>
      stages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        source: stage.source,
        quantity: quantities[stage.id] ?? 0,
        priceEth: stage.priceEth,
        feeRecipient: stage.feeRecipient ?? null,
      })),
    [quantities, stages],
  );
  const executableStageCount = selectedStages.filter((stage) => stage.source === "onchain-seadrop" && stage.quantity > 0 && stage.feeRecipient).length;
  const unlockedVault = useMemo<UnlockedLaunchVault | null>(() => {
    if (!vault) return null;
    return {
      status: "unlocked",
      unlockedAt: new Date().toISOString(),
      wallets: vault.wallets.map((wallet) => ({
        alias: wallet.label,
        address: wallet.address,
        chain: wallet.chain,
        privateKey: wallet.privateKey,
      })),
    };
  }, [vault]);
  const chain = useMemo(() => browserChainConfig({ chainKey, rpcUrl, seaDropAddress }), [chainKey, rpcUrl, seaDropAddress]);
  const gasStrategy = useMemo(() => buildBrowserGasStrategy({ maxFeeGwei, priorityFeeGwei, retryLimit, escalationPercent, nonceMode }), [maxFeeGwei, priorityFeeGwei, retryLimit, escalationPercent, nonceMode]);
  const simulatedCount = transactions.filter((tx) => tx.status === "simulated").length;
  const broadcastCount = transactions.filter((tx) => tx.status === "broadcast").length;
  const failedCount = transactions.filter((tx) => tx.status === "failed").length;
  const canOpenBroadcast = transactions.length > 0 && simulatedCount === transactions.length;
  const canExportBrowserReport = transactions.length > 0 && transactions.some((tx) => tx.status === "broadcast" || tx.status === "failed" || tx.status === "simulated");

  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    if (!encryptedBackup) {
      setError("Create and seal wallets in the Vault tab before browser-side signing.");
      return;
    }
    setBusy("Unlocking encrypted launch vault…");
    try {
      const payload = await decryptLaunchVaultBackup(encryptedBackup, unlockPassphrase);
      setVault(payload);
      setUnlockPassphrase("");
      setNotice("Vault unlocked in memory. Private keys are not displayed and no server API receives them.");
    } catch {
      setError("Unlock failed. Check the vault passphrase.");
    } finally {
      setBusy(null);
    }
  }

  function handlePrepare() {
    resetMessages();
    try {
      const plan = buildBrowserMintPlan({
        chainKey,
        collectionAddress: collection.address,
        stages: selectedStages,
        walletCount,
        vault: unlockedVault,
        rpcUrl,
        seaDropAddress,
      });
      setTransactions(plan.transactions);
      setNotice(`Prepared ${plan.transactions.length} transaction(s). Dry-run simulation is required before broadcast.`);
    } catch (err) {
      setTransactions([]);
      setError(err instanceof Error ? err.message : "Could not prepare browser transactions.");
    }
  }

  async function handleSimulate() {
    resetMessages();
    let current = transactions;
    if (current.length === 0) {
      try {
        const plan = buildBrowserMintPlan({
          chainKey,
          collectionAddress: collection.address,
          stages: selectedStages,
          walletCount,
          vault: unlockedVault,
          rpcUrl,
          seaDropAddress,
        });
        current = plan.transactions;
        setTransactions(current);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not prepare browser transactions.");
        return;
      }
    }

    setBusy("Simulating transactions against the selected RPC…");
    const next: BrowserPreparedMint[] = [];
    for (const tx of current) {
      setTransactions([...next, { ...tx, status: "prepared" }]);
      next.push(await simulatePreparedBrowserMint(tx));
    }
    setTransactions(next);
    setBusy(null);
    const failures = next.filter((tx) => tx.status === "failed").length;
    if (failures > 0) setError(`${failures} simulation(s) failed. Broadcast remains locked until every transaction simulates successfully.`);
    else setNotice("All transactions simulated successfully. Review the explicit broadcast modal before signing.");
  }

  async function handleBroadcastConfirmed() {
    resetMessages();
    setBusy("Signing and broadcasting from unlocked in-memory keys…");
    const next: BrowserPreparedMint[] = [];
    for (const tx of transactions) {
      const sent = await broadcastPreparedBrowserMint(tx, { explicitConsent: broadcastConsent });
      next.push(sent);
      setTransactions([...next, ...transactions.slice(next.length)]);
    }
    setTransactions(next);
    setBusy(null);
    setBroadcastOpen(false);
    setBroadcastConsent(false);
    const failures = next.filter((tx) => tx.status === "failed").length;
    if (failures > 0) setError(`${failures} transaction(s) failed during broadcast. Check row errors before retrying.`);
    else setNotice("Broadcast submitted. Track transaction status with the explorer links below.");
  }

  function handleDownloadReport() {
    const report = buildBrowserRunReport({
      collection: { address: collection.address, name: collection.name },
      chain,
      transactions,
      gasStrategy,
    });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `browser-run-report-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice("Downloaded browser run report. It contains tx hashes, gas estimates, statuses, and no private keys.");
  }

  function resetMessages() {
    setNotice(null);
    setError(null);
  }

  return (
    <section className="rounded-[2rem] border border-amber-200 bg-amber-50/75 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-700">Browser signer</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">Encrypted-vault gated broadcast</h2>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-amber-900/80">
            Keys decrypt only in this browser session from the Vault tab backup. Public SeaDrop stages are prepared locally, simulated first, then require an explicit broadcast modal. Signed/FCFS stages remain preview-only.
          </p>
        </div>
        <div className="grid gap-2 rounded-2xl border border-amber-200 bg-white/75 p-3 text-xs font-black text-amber-800 sm:grid-cols-3 lg:min-w-80">
          <Metric label="Vault" value={vault ? `${vault.wallets.length} unlocked` : encryptedBackup ? "locked" : "missing"} />
          <Metric label="Dry-run" value={simulatedCount ? `${simulatedCount}/${transactions.length}` : "required"} />
          <Metric label="Broadcast" value={broadcastCount ? `${broadcastCount} sent` : "modal gated"} />
        </div>
      </div>

      {notice ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</div> : null}
      {error ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}
      {busy ? <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm font-black text-violet-700">{busy}</div> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
        <form onSubmit={handleUnlock} className="rounded-3xl border border-amber-200 bg-white/80 p-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Vault unlock</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
            {encryptedBackup ? "Use the Vault tab passphrase. The backup stays in localStorage as ciphertext." : "No encrypted launch vault found in this browser yet."}
          </p>
          <label className="mt-4 grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Passphrase
            <input value={unlockPassphrase} onChange={(event) => setUnlockPassphrase(event.target.value)} type="password" autoComplete="current-password" className={FIELD} />
          </label>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button type="submit" disabled={!encryptedBackup || Boolean(busy)} className="h-11 rounded-2xl bg-amber-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50">
              Unlock vault
            </button>
            <button type="button" onClick={() => setVault(null)} disabled={!vault} className="h-11 rounded-2xl border border-amber-200 bg-white px-4 text-sm font-black text-amber-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
              Drop keys from memory
            </button>
          </div>
        </form>

        <div className="rounded-3xl border border-amber-200 bg-white/80 p-4">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Execution path</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              Chain
              <select value={chainKey} onChange={(event) => setChainKey(event.target.value as BrowserBroadcastChainKey)} className={FIELD}>
                {CHAINS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500 sm:col-span-2">
              RPC URL
              <input value={rpcUrl} onChange={(event) => setRpcUrl(event.target.value)} placeholder={chain.rpcUrl ?? "Required for Robinhood"} className={`${FIELD} font-mono normal-case tracking-normal`} />
            </label>
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500 sm:col-span-3">
              SeaDrop address override
              <input value={seaDropAddress} onChange={(event) => setSeaDropAddress(event.target.value)} placeholder={chain.seaDropAddress ?? "Required for Robinhood"} className={`${FIELD} font-mono normal-case tracking-normal`} />
            </label>
          </div>

          {chain.warnings.length > 0 ? <ul className="mt-3 space-y-1 text-xs font-bold text-amber-800">{chain.warnings.map((warning) => <li key={warning}>⚠ {warning}</li>)}</ul> : null}

          <div className="mt-4 grid gap-2 text-sm font-semibold sm:grid-cols-3">
            <Metric label="Executable stages" value={executableStageCount} />
            <Metric label="Wallets requested" value={Math.min(walletCount, vault?.wallets.length ?? 0)} />
            <Metric label="Failures" value={failedCount} />
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Gas / retry plan</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-5">
              <input aria-label="Max fee gwei" value={maxFeeGwei} onChange={(event) => setMaxFeeGwei(Number(event.target.value))} type="number" step="0.001" className={FIELD} />
              <input aria-label="Priority fee gwei" value={priorityFeeGwei} onChange={(event) => setPriorityFeeGwei(Number(event.target.value))} type="number" step="0.001" className={FIELD} />
              <input aria-label="Retry limit" value={retryLimit} onChange={(event) => setRetryLimit(Number(event.target.value))} type="number" className={FIELD} />
              <input aria-label="Escalation percent" value={escalationPercent} onChange={(event) => setEscalationPercent(Number(event.target.value))} type="number" className={FIELD} />
              <select aria-label="Nonce mode" value={nonceMode} onChange={(event) => setNonceMode(event.target.value as "sequential" | "parallel")} className={FIELD}>
                <option value="sequential">sequential nonce</option>
                <option value="parallel">parallel nonce</option>
              </select>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-black text-slate-600">
              {gasStrategy.attempts.map((attempt) => <span key={attempt.attempt} className="rounded-full border border-slate-200 bg-white px-3 py-1">#{attempt.attempt} max {attempt.maxFeeGwei} / prio {attempt.priorityFeeGwei} gwei</span>)}
            </div>
            {gasStrategy.warnings.length ? <ul className="mt-2 space-y-1 text-xs font-bold text-amber-700">{gasStrategy.warnings.map((warning) => <li key={warning}>⚠ {warning}</li>)}</ul> : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button type="button" onClick={handlePrepare} disabled={!vault || !chain.ready || Boolean(busy)} className="h-12 rounded-2xl border border-amber-200 bg-white px-4 font-black text-amber-700 shadow-sm transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50">
              Prepare local txs
            </button>
            <button type="button" onClick={handleSimulate} disabled={!vault || !chain.ready || Boolean(busy)} className="h-12 rounded-2xl border border-violet-200 bg-white px-4 font-black text-violet-700 shadow-sm transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50">
              Dry-run simulate
            </button>
            <button type="button" onClick={() => setBroadcastOpen(true)} disabled={!canOpenBroadcast || Boolean(busy)} className="h-12 rounded-2xl bg-slate-950 px-4 font-black text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
              Open broadcast modal
            </button>
            <button type="button" onClick={handleDownloadReport} disabled={!canExportBrowserReport || Boolean(busy)} className="h-12 rounded-2xl border border-emerald-200 bg-white px-4 font-black text-emerald-700 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-3">
              Download browser report
            </button>
          </div>
        </div>
      </div>

      {transactions.length > 0 ? <TransactionTable transactions={transactions} /> : null}

      {broadcastOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="broadcast-title">
          <div className="w-full max-w-2xl rounded-[2rem] border border-red-200 bg-white p-5 shadow-2xl shadow-slate-950/25">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-red-600">Explicit broadcast</p>
                <h3 id="broadcast-title" className="mt-2 text-2xl font-black text-slate-950">Sign and send {transactions.length} transaction(s)?</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">This uses private keys currently decrypted in browser memory. The app does not send keys to a server, but this will broadcast real transactions to {chain.name}.</p>
              </div>
              <button type="button" onClick={() => setBroadcastOpen(false)} className="rounded-full border border-slate-200 px-3 py-1 text-sm font-black text-slate-600">Close</button>
            </div>
            <label className="mt-5 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
              <input type="checkbox" checked={broadcastConsent} onChange={(event) => setBroadcastConsent(event.target.checked)} className="mt-1" />
              <span>I reviewed the dry-run results, chain, RPC URL, SeaDrop address, costs, and wallet count. Broadcast these transactions now.</span>
            </label>
            <button type="button" onClick={handleBroadcastConfirmed} disabled={!broadcastConsent || Boolean(busy)} className="mt-4 h-12 w-full rounded-2xl bg-red-600 px-5 font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">
              Broadcast signed transactions
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TransactionTable({ transactions }: { transactions: BrowserPreparedMint[] }) {
  return (
    <div className="mt-5 overflow-hidden rounded-3xl border border-amber-200 bg-white/85">
      <div className="grid gap-3 border-b border-amber-100 bg-amber-50 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-amber-700 md:grid-cols-[1fr_0.7fr_0.7fr_0.9fr]">
        <span>Wallet</span>
        <span>Status</span>
        <span>Value</span>
        <span>Explorer</span>
      </div>
      <div className="divide-y divide-amber-100">
        {transactions.map((tx) => (
          <article key={tx.id} className="grid gap-2 px-4 py-3 text-sm font-semibold text-slate-600 md:grid-cols-[1fr_0.7fr_0.7fr_0.9fr] md:items-center">
            <div>
              <p className="font-black text-slate-950">{tx.walletAlias}</p>
              <p className="font-mono text-xs text-slate-500">{maskVaultAddress(tx.walletAddress)}</p>
            </div>
            <div><StatusPill status={tx.status} gas={tx.simulationGas} /></div>
            <div className="font-mono text-xs">{formatEther(tx.request.value)} ETH</div>
            <div className="min-w-0">
              {tx.explorerUrl ? <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="break-all text-xs font-black text-violet-700 hover:text-violet-500">{tx.hash}</a> : tx.error ? <span className="text-xs font-bold text-red-700">{tx.error}</span> : <span className="text-xs text-slate-400">Not broadcast</span>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ gas, status }: { gas?: string; status: BrowserPreparedMint["status"] }) {
  const tone = status === "broadcast" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === "simulated" ? "border-violet-200 bg-violet-50 text-violet-700" : status === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${tone}`}>{status}{gas ? ` · ${gas} gas` : ""}</span>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-amber-100 bg-white/80 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-black text-slate-950">{value}</p>
    </div>
  );
}

function defaultChainKey(key: string): BrowserBroadcastChainKey {
  return key === "ethereum" || key === "base" || key === "robinhood" ? key : "base";
}

function readStoredVaultBackup(): EncryptedLaunchVaultBackup | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAUNCH_VAULT_STORAGE_KEY);
    // Loads encrypted vault backup only; plaintext private keys never enter storage.
    return raw ? parseEncryptedLaunchVaultBackup(raw) : null;
  } catch {
    return null;
  }
}
