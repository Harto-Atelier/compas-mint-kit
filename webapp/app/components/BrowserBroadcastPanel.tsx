"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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
  invalidateBrowserMintTransactions,
  isTerminalBrowserMint,
  revokePreparedBrowserMintSigners,
  simulatePreparedBrowserMint,
  reviewPreparedBrowserMintCalldata,
  type BrowserBroadcastChainKey,
  type BrowserMintRecipientMode,
  type BrowserMintStageInput,
  type BrowserPreparedMint,
  type UnlockedLaunchVault,
} from "@/lib/browser-broadcast";
import type { CollectionCard, MintStage, StageKind } from "@/lib/mint-types";
import { fetchSignedGateSession, type CompasGateSession } from "@/lib/compas-gate";
import { COMPAS_AUTOPILOT_HANDOFF_KEY, type CompasAutopilotHandoff } from "@/lib/compas-autopilot";

const FIELD = "h-11 rounded-2xl border border-violet-100 bg-white px-3 text-sm font-bold text-slate-950 outline-none shadow-sm placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100";
const CHAINS: BrowserBroadcastChainKey[] = ["ethereum", "base", "robinhood"];

type BrowserBroadcastPanelProps = {
  collection: CollectionCard;
  stages: MintStage[];
  quantities: Record<StageKind, number>;
};

export default function BrowserBroadcastPanel({ collection, quantities, stages }: BrowserBroadcastPanelProps) {
  const [vault, setVault] = useState<LaunchVaultPayload | null>(null);
  const [browserWalletCount, setBrowserWalletCount] = useState(1);
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
  const [broadcastConsentBinding, setBroadcastConsentBinding] = useState<string | null>(null);
  const [autopilotHandoff, setAutopilotHandoff] = useState<CompasAutopilotHandoff | null>(() => readAutopilotHandoff());
  const [maxFeeGwei, setMaxFeeGwei] = useState(() => autopilotHandoff?.signerDefaults.maxGasGwei ?? 0.08);
  const [priorityFeeGwei, setPriorityFeeGwei] = useState(0.02);
  const [maxTotalEth, setMaxTotalEth] = useState(() => autopilotHandoff?.signerDefaults.maxTotalEth ?? 0.05);
  const [retryLimit, setRetryLimit] = useState(2);
  const [escalationPercent, setEscalationPercent] = useState(15);
  const [nonceMode, setNonceMode] = useState<"sequential" | "parallel">("sequential");
  const [recipientMode, setRecipientMode] = useState<BrowserMintRecipientMode>("holder");
  const [customRecipientAddress, setCustomRecipientAddress] = useState("");
  const [holderSession, setHolderSession] = useState<CompasGateSession | null>(null);

  useEffect(() => {
    fetchSignedGateSession().then(setHolderSession).catch(() => setHolderSession(null));
  }, []);

  const handoffMatchesCollection = autopilotHandoff?.signerDefaults.collectionAddress.toLowerCase() === collection.address.toLowerCase();
  const selectedStages = useMemo<BrowserMintStageInput[]>(
    () => {
      return stages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        source: stage.source,
        quantity: handoffMatchesCollection && stage.id === "public" ? autopilotHandoff.signerDefaults.quantity : (quantities[stage.id] ?? 0),
        priceEth: stage.priceEth,
        feeRecipient: stage.feeRecipient ?? null,
      }));
    },
    [autopilotHandoff, handoffMatchesCollection, quantities, stages],
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
  const activeTransactions = useMemo(() => transactions.filter((tx) => !isTerminalBrowserMint(tx)), [transactions]);
  const simulatedCount = activeTransactions.filter((tx) => tx.status === "simulated").length;
  const broadcastCount = transactions.filter((tx) => tx.status === "broadcast").length;
  const failedCount = transactions.filter((tx) => tx.status === "failed").length;
  const canExportBrowserReport = transactions.length > 0 && transactions.some((tx) => tx.status === "broadcast" || tx.status === "failed" || tx.status === "simulated");
  const safetyReviews = useMemo(
    () => activeTransactions.map((tx) => ({
      tx,
      review: reviewPreparedBrowserMintCalldata(tx, { collectionAddress: collection.address, holderRecipientAddress: holderSession?.address, maxQuantity: autopilotHandoff?.signerDefaults.quantity ?? 1 }),
    })),
    [activeTransactions, collection.address, holderSession, autopilotHandoff],
  );
  const allSafetyChecksPass = safetyReviews.length === 0 || safetyReviews.every((item) => item.review.readyForBroadcast);
  const activeBinding = activeTransactions.length > 0 && activeTransactions.every((tx) => tx.binding === activeTransactions[0].binding) ? activeTransactions[0].binding : null;
  const activeTotalValueWei = activeTransactions.reduce((total, tx) => total + tx.request.value, BigInt(0));
  const canOpenBroadcast = Boolean(activeBinding) && activeTransactions.length > 0 && simulatedCount === activeTransactions.length && allSafetyChecksPass;

  useEffect(() => {
    const invalidationTimer = window.setTimeout(() => {
      setTransactions((current) => current.some((tx) => !isTerminalBrowserMint(tx)) ? invalidateBrowserMintTransactions(current) : current);
      setBroadcastOpen(false);
      setBroadcastConsent(false);
      setBroadcastConsentBinding(null);
    }, 0);
    return () => window.clearTimeout(invalidationTimer);
  }, [browserWalletCount, chainKey, collection.address, customRecipientAddress, holderSession?.address, maxTotalEth, recipientMode, rpcUrl, seaDropAddress, selectedStages]);

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
      revokePreparedBrowserMintSigners(transactions);
      setTransactions((current) => current.filter(isTerminalBrowserMint));
      setVault(payload);
      setBrowserWalletCount(Math.max(1, payload.wallets.length));
      setUnlockPassphrase("");
      setBroadcastOpen(false);
      setBroadcastConsent(false);
      setBroadcastConsentBinding(null);
      setNotice("Vault unlocked in memory. Private keys are not displayed and no server API receives them.");
    } catch {
      setError("Unlock failed. Check the vault passphrase.");
    } finally {
      setBusy(null);
    }
  }

  function handleDropKeys() {
    revokePreparedBrowserMintSigners(transactions);
    setTransactions((current) => current.filter(isTerminalBrowserMint));
    setVault(null);
    setBroadcastOpen(false);
    setBroadcastConsent(false);
    setBroadcastConsentBinding(null);
    setNotice("Unlocked signer authority was revoked and keys were dropped from browser memory. Terminal broadcast rows were retained for reporting.");
  }

  function handlePrepare() {
    resetMessages();
    try {
      const plan = buildBrowserMintPlan({
        chainKey,
        collectionAddress: collection.address,
        stages: selectedStages,
        walletCount: browserWalletCount,
        vault: unlockedVault,
        rpcUrl,
        seaDropAddress,
        recipientMode,
        holderRecipientAddress: holderSession?.address,
        customRecipientAddress,
        maxTotalEth,
      });
      const terminalRows = invalidateBrowserMintTransactions(transactions);
      const alreadyBroadcast = new Set(terminalRows.map((tx) => `${tx.binding}:${tx.id}`));
      const next = [...terminalRows, ...plan.transactions.filter((tx) => !alreadyBroadcast.has(`${tx.binding}:${tx.id}`))];
      setTransactions(next);
      setBroadcastOpen(false);
      setBroadcastConsent(false);
      setBroadcastConsentBinding(null);
      const preparedCount = next.length - terminalRows.length;
      if (preparedCount === 0) {
        setNotice("This exact bound transaction plan was already broadcast. Change the reviewed execution inputs before preparing another run.");
      } else {
        setNotice(`Prepared ${preparedCount} transaction(s). Dry-run simulation is required before broadcast.`);
      }
    } catch (err) {
      setTransactions((current) => invalidateBrowserMintTransactions(current));
      setError(err instanceof Error ? err.message : "Could not prepare browser transactions.");
    }
  }

  async function handleSimulate() {
    resetMessages();
    let current = activeTransactions;
    let terminalRows = transactions.filter(isTerminalBrowserMint);
    if (current.length === 0) {
      try {
        const plan = buildBrowserMintPlan({
          chainKey,
          collectionAddress: collection.address,
          stages: selectedStages,
          walletCount: browserWalletCount,
          vault: unlockedVault,
          rpcUrl,
          seaDropAddress,
          recipientMode,
          holderRecipientAddress: holderSession?.address,
          customRecipientAddress,
          maxTotalEth,
        });
        terminalRows = invalidateBrowserMintTransactions(transactions);
        const alreadyBroadcast = new Set(terminalRows.map((tx) => `${tx.binding}:${tx.id}`));
        current = plan.transactions.filter((tx) => !alreadyBroadcast.has(`${tx.binding}:${tx.id}`));
        setTransactions([...terminalRows, ...current]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not prepare browser transactions.");
        return;
      }
    }
    if (current.length === 0) {
      setNotice("This exact bound transaction plan was already broadcast. No transaction was simulated or sent again.");
      return;
    }

    setBusy("Simulating transactions against the selected RPC…");
    const next: BrowserPreparedMint[] = [...terminalRows, ...current];
    for (const [index, tx] of next.entries()) {
      if (isTerminalBrowserMint(tx)) continue;
      next[index] = await simulatePreparedBrowserMint(tx);
      setTransactions([...next]);
    }
    setTransactions(next);
    setBusy(null);
    const failures = next.filter((tx) => tx.status === "failed").length;
    if (failures > 0) setError(`${failures} simulation(s) failed. Broadcast remains locked until every transaction simulates successfully.`);
    else setNotice("All transactions simulated successfully. Review the explicit broadcast modal before signing.");
  }

  function handleOpenBroadcast() {
    if (!activeBinding || !canOpenBroadcast) return;
    setBroadcastConsent(false);
    setBroadcastConsentBinding(activeBinding);
    setBroadcastOpen(true);
  }

  function handleCloseBroadcast() {
    setBroadcastOpen(false);
    setBroadcastConsent(false);
    setBroadcastConsentBinding(null);
  }

  async function handleBroadcastConfirmed() {
    resetMessages();
    if (!broadcastConsent || !broadcastConsentBinding || broadcastConsentBinding !== activeBinding) {
      setError("Broadcast consent no longer matches the exact simulated plan. Review the modal again.");
      return;
    }
    setBusy("Signing and broadcasting from unlocked in-memory keys…");
    const next = [...transactions];
    for (const [index, tx] of next.entries()) {
      if (isTerminalBrowserMint(tx)) continue;
      const sent = await broadcastPreparedBrowserMint(tx, {
        explicitConsent: broadcastConsent,
        consentBinding: broadcastConsentBinding,
      });
      next[index] = sent;
      setTransactions([...next]);
    }
    setTransactions(next);
    setBusy(null);
    setBroadcastOpen(false);
    setBroadcastConsent(false);
    setBroadcastConsentBinding(null);
    const failures = next.filter((tx) => tx.status === "failed").length;
    if (failures > 0) setError(`${failures} transaction(s) failed during broadcast. Check row errors before preparing a fresh reviewed plan.`);
    else setNotice("Broadcast submitted once for each reviewed row. Track transaction status with the explorer links below.");
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

  function clearAutopilotHandoff() {
    window.localStorage.removeItem(COMPAS_AUTOPILOT_HANDOFF_KEY);
    setAutopilotHandoff(null);
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
      {autopilotHandoff ? (
        <div id="browser-signer" className="mt-4 rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm font-bold text-fuchsia-800">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>Autopilot handoff loaded: {autopilotHandoff.proposal.candidate.name} · recipient holder · max {autopilotHandoff.signerDefaults.maxTotalEth} ETH. Simulate manually before any broadcast.</p>
            <button type="button" onClick={clearAutopilotHandoff} className="rounded-full bg-white px-3 py-1 text-xs font-black text-fuchsia-700">Clear handoff</button>
          </div>
        </div>
      ) : null}

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
            <button type="button" onClick={handleDropKeys} disabled={!vault} className="h-11 rounded-2xl border border-amber-200 bg-white px-4 text-sm font-black text-amber-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
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

          <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/70 p-3">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">Mint destination</p>
            <p className="mt-1 text-xs font-bold text-slate-600">SeaDrop public mints can route the NFT recipient separately from the burner payer. Signed/mock stages stay disabled.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <label className="rounded-2xl border border-white bg-white px-3 py-2 text-xs font-black text-slate-700">
                <input type="radio" checked={recipientMode === "payer"} onChange={() => setRecipientMode("payer")} className="mr-2" />Payer wallet
              </label>
              <label className="rounded-2xl border border-white bg-white px-3 py-2 text-xs font-black text-slate-700">
                <input type="radio" checked={recipientMode === "holder"} onChange={() => setRecipientMode("holder")} className="mr-2" />Compas holder
              </label>
              <label className="rounded-2xl border border-white bg-white px-3 py-2 text-xs font-black text-slate-700">
                <input type="radio" checked={recipientMode === "custom"} onChange={() => setRecipientMode("custom")} className="mr-2" />Custom
              </label>
            </div>
            <div className="mt-3 grid gap-2 text-xs font-bold text-slate-600">
              {recipientMode === "holder" ? <p className="rounded-2xl bg-white px-3 py-2">Recipient: {holderSession ? maskVaultAddress(holderSession.address) : "verified holder session required"}</p> : null}
              {recipientMode === "custom" ? <input value={customRecipientAddress} onChange={(event) => setCustomRecipientAddress(event.target.value)} placeholder="0x recipient address" className={`${FIELD} font-mono normal-case tracking-normal`} /> : null}
              <p className="rounded-2xl bg-white px-3 py-2">Payer remains the unlocked burner wallet; report records payer + recipient separately.</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr]">
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              Burners used
              <input
                type="number"
                min={1}
                max={Math.max(1, vault?.wallets.length ?? 1)}
                value={browserWalletCount}
                onChange={(event) => setBrowserWalletCount(Math.min(Math.max(1, Number(event.target.value) || 1), Math.max(1, vault?.wallets.length ?? 1)))}
                className={FIELD}
              />
            </label>
            <div className="grid gap-2 text-sm font-semibold sm:grid-cols-3">
              <Metric label="Executable stages" value={executableStageCount} />
              <Metric label="Burners ready" value={Math.min(browserWalletCount, vault?.wallets.length ?? 0)} />
              <Metric label="Failures" value={failedCount} />
            </div>
          </div>

          <label className="mt-4 grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Maximum mint spend ETH
            <input aria-label="Maximum mint spend ETH" value={maxTotalEth} onChange={(event) => setMaxTotalEth(Number(event.target.value))} type="number" min="0" step="0.001" className={FIELD} />
            <span className="normal-case tracking-normal text-slate-500">Hard cap for aggregate mint value across every reviewed burner transaction. Network gas is separate.</span>
          </label>

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

          {safetyReviews.length ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Pre-broadcast decoded calldata</p>
              <p className="mt-1 text-xs font-bold text-slate-600">Broadcast stays disabled unless every tx decodes to SeaDrop mintPublic, recipient matches policy, quantity is within canary, and simulation passed.</p>
              <div className="mt-3 space-y-2">
                {safetyReviews.slice(0, 3).map(({ tx, review }) => (
                  <div key={tx.id} className="rounded-2xl bg-white p-3 text-xs font-bold text-slate-600">
                    <p className="font-black text-slate-950">{tx.walletAlias} → {maskVaultAddress(tx.recipientAddress)} · {review.functionName}</p>
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {review.checks.map((check) => <span key={`${tx.id}-${check.id}`} className={check.ok ? "text-emerald-700" : "text-red-700"}>{check.ok ? "✓" : "✕"} {check.label}: {check.value}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button type="button" onClick={handlePrepare} disabled={!vault || !chain.ready || Boolean(busy)} className="h-12 rounded-2xl border border-amber-200 bg-white px-4 font-black text-amber-700 shadow-sm transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50">
              Prepare local txs
            </button>
            <button type="button" onClick={handleSimulate} disabled={!vault || !chain.ready || Boolean(busy)} className="h-12 rounded-2xl border border-violet-200 bg-white px-4 font-black text-violet-700 shadow-sm transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50">
              Dry-run simulate
            </button>
            <button type="button" onClick={handleOpenBroadcast} disabled={!canOpenBroadcast || Boolean(busy)} className="h-12 rounded-2xl bg-slate-950 px-4 font-black text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
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
          <div className="max-h-[calc(100dvh-3rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-[2rem] border border-red-200 bg-white p-5 shadow-2xl shadow-slate-950/25">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-red-600">Explicit broadcast</p>
                <h3 id="broadcast-title" className="mt-2 text-2xl font-black text-slate-950">Sign and send {activeTransactions.length} transaction(s)?</h3>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">This uses private keys currently decrypted in browser memory. The app does not send keys to a server, but this will broadcast real transactions to {chain.name}.</p>
              </div>
              <button type="button" onClick={handleCloseBroadcast} className="rounded-full border border-slate-200 px-3 py-1 text-sm font-black text-slate-600">Close</button>
            </div>
            <div className="mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs font-bold text-slate-700 sm:grid-cols-2">
              <p><span className="block uppercase tracking-[0.14em] text-slate-400">Collection</span>{collection.name}<span className="block font-mono">{maskVaultAddress(collection.address)}</span></p>
              <p><span className="block uppercase tracking-[0.14em] text-slate-400">Chain</span>{chain.name} · {chain.chainId}</p>
              <p><span className="block uppercase tracking-[0.14em] text-slate-400">Maximum spend</span>{maxTotalEth} ETH mint cap · {formatEther(activeTotalValueWei)} ETH reviewed</p>
              <p><span className="block uppercase tracking-[0.14em] text-slate-400">Verified recipient</span>{recipientMode === "holder" && holderSession ? maskVaultAddress(holderSession.address) : recipientMode === "custom" ? maskVaultAddress(customRecipientAddress) : "payer wallets"}</p>
              <BroadcastPayerSummary
                payers={activeTransactions.map((tx) => ({
                  id: `${tx.binding}:${tx.id}`,
                  alias: tx.walletAlias,
                  address: tx.walletAddress,
                }))}
              />
            </div>
            <label className="mt-5 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
              <input type="checkbox" checked={broadcastConsent} onChange={(event) => setBroadcastConsent(event.target.checked)} className="mt-1" />
              <span>I reviewed the dry-run results, chain, RPC URL, SeaDrop address, costs, and wallet count. Broadcast these transactions now.</span>
            </label>
            <button type="button" onClick={handleBroadcastConfirmed} disabled={!broadcastConsent || broadcastConsentBinding !== activeBinding || Boolean(busy)} className="mt-4 h-12 w-full rounded-2xl bg-red-600 px-5 font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">
              Broadcast signed transactions
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function BroadcastPayerSummary({
  payers,
}: {
  payers: Array<{ id: string; alias: string; address: string }>;
}) {
  return (
    <div className="sm:col-span-2">
      <p className="uppercase tracking-[0.14em] text-slate-400">{payers.length} burner payers</p>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {payers.map((payer) => (
          <li key={payer.id} className="min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-1.5">
            <span className="block truncate font-black text-slate-800">{payer.alias}</span>
            <span className="block font-mono text-slate-500">{maskVaultAddress(payer.address)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TransactionTable({ transactions }: { transactions: BrowserPreparedMint[] }) {
  return (
    <div className="mt-5 overflow-hidden rounded-3xl border border-amber-200 bg-white/85">
      <div className="grid gap-3 border-b border-amber-100 bg-amber-50 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-amber-700 md:grid-cols-[1fr_0.8fr_0.7fr_0.7fr_0.9fr]">
        <span>Payer</span>
        <span>Recipient</span>
        <span>Status</span>
        <span>Value</span>
        <span>Explorer</span>
      </div>
      <div className="divide-y divide-amber-100">
        {transactions.map((tx) => (
          <article key={`${tx.binding}:${tx.id}:${tx.hash ?? tx.status}`} className="grid gap-2 px-4 py-3 text-sm font-semibold text-slate-600 md:grid-cols-[1fr_0.8fr_0.7fr_0.7fr_0.9fr] md:items-center">
            <div>
              <p className="font-black text-slate-950">{tx.walletAlias}</p>
              <p className="font-mono text-xs text-slate-500">{maskVaultAddress(tx.walletAddress)}</p>
            </div>
            <div>
              <p className="font-black text-slate-950">{tx.recipientMode}</p>
              <p className="font-mono text-xs text-slate-500">{maskVaultAddress(tx.recipientAddress)}</p>
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

function readAutopilotHandoff(): CompasAutopilotHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMPAS_AUTOPILOT_HANDOFF_KEY) ?? "null") as Partial<CompasAutopilotHandoff> | null;
    return parsed?.schemaVersion === "compas-autopilot-handoff.v1" ? (parsed as CompasAutopilotHandoff) : null;
  } catch {
    return null;
  }
}
