"use client";

import { FormEvent, useMemo, useState, useEffect } from "react";
import { formatEther, parseEther, parseUnits } from "ethers";

import {
  LAUNCH_VAULT_STORAGE_KEY,
  decryptLaunchVaultBackup,
  maskVaultAddress,
  parseEncryptedLaunchVaultBackup,
  type LaunchVaultPublicWallet,
} from "@/lib/encrypted-launch-vault";
import {
  GUIDED_HOLDER_STEPS,
  buildGuidedFundingReview,
  buildGuidedMintSimulationPlan,
  projectGuidedBurners,
  requireExecutablePublicStage,
  resolveGuidedHolderStep,
  type GuidedHolderStepId,
} from "@/lib/guided-holder-flow";
import {
  checkConnectedHolderFundingPreflight,
  submitConnectedHolderFundingTransaction,
  verifyConnectedHolderFundingTransaction,
  type ConnectedHolderFundingPreflight,
  type ConnectedHolderFundingSubmission,
  type ConnectedHolderFundingVerification,
  type Eip1193Provider,
} from "@/lib/connected-holder-funding";
import type { BurnerFundingPlan } from "@/lib/burner-funding";
import { fetchSignedGateSession, readGateSession, type CompasGateSession } from "@/lib/compas-gate";
import { simulatePreparedBrowserMint, type BrowserPreparedMint } from "@/lib/browser-broadcast";
import type { MintDiscoveryError, MintDiscoveryResponse } from "@/lib/mint-types";

type AdvancedTab = "Vault" | "Mints" | "Disperse";

type GuidedHolderFlowProps = {
  embedded?: boolean;
  onOpenAdvanced?: (tab: AdvancedTab) => void;
};

const FIELD = "h-11 w-full rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-card)] px-3 text-sm font-bold text-[color:var(--compas-ink)] outline-none focus:border-[color:var(--compas-accent)]";
const CARD = "rounded-[1.75rem] border border-[color:var(--compas-line)] bg-[color:var(--compas-card)] p-4 sm:p-5";

export default function GuidedHolderFlow({ embedded = false, onOpenAdvanced }: GuidedHolderFlowProps) {
  const [holder, setHolder] = useState<CompasGateSession | null>(null);
  const [step, setStep] = useState<GuidedHolderStepId>("holder");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [burners, setBurners] = useState<LaunchVaultPublicWallet[]>([]);
  const [selectedBurnerAddresses, setSelectedBurnerAddresses] = useState<string[]>([]);

  const [query, setQuery] = useState("");
  const [chainKey, setChainKey] = useState("base");
  const [discovery, setDiscovery] = useState<MintDiscoveryResponse | null>(null);

  const [quantityPerBurner, setQuantityPerBurner] = useState(1);
  const [mintGasLimit, setMintGasLimit] = useState(250_000);
  const [maxFeeGwei, setMaxFeeGwei] = useState("0.08");
  const [bufferPercent, setBufferPercent] = useState("5");
  const [maxTotalEth, setMaxTotalEth] = useState("0.25");
  const [reviewedQuantity, setReviewedQuantity] = useState<number | null>(null);
  const [fundingPlan, setFundingPlan] = useState<BurnerFundingPlan | null>(null);
  const [preflight, setPreflight] = useState<ConnectedHolderFundingPreflight | null>(null);
  const [fundingConsent, setFundingConsent] = useState<Record<string, boolean>>({});
  const [submissions, setSubmissions] = useState<Record<string, ConnectedHolderFundingSubmission>>({});
  const [verifications, setVerifications] = useState<ConnectedHolderFundingVerification[]>([]);

  const [simulationPassphrase, setSimulationPassphrase] = useState("");
  const [simulations, setSimulations] = useState<BrowserPreparedMint[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchSignedGateSession()
      .then((session) => {
        if (cancelled) return;
        const verified = session ?? readGateSession();
        setHolder(verified);
        if (verified) setStep("burners");
      })
      .catch(() => {
        if (cancelled) return;
        const verified = readGateSession();
        setHolder(verified);
        if (verified) setStep("burners");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBurners = useMemo(
    () => burners.filter((wallet) => selectedBurnerAddresses.some((address) => address.toLowerCase() === wallet.address.toLowerCase())),
    [burners, selectedBurnerAddresses],
  );
  const fundingComplete = useMemo(
    () => Boolean(fundingPlan) && fundingPlan!.transactions.every((row) => verifications.some((verification) => verification.transactionId === row.id && verification.verified)),
    [fundingPlan, verifications],
  );
  const readiness = {
    holder: Boolean(holder),
    burners: selectedBurners.length > 0,
    drop: Boolean(discovery),
    fundingReview: Boolean(fundingPlan),
    fundingComplete,
  };
  const recommendedStep = resolveGuidedHolderStep(readiness);
  const maxReachableIndex = GUIDED_HOLDER_STEPS.findIndex((item) => item.id === recommendedStep);

  function resetMessages() {
    setNotice(null);
    setError(null);
  }

  function openAdvanced(tab: AdvancedTab) {
    if (onOpenAdvanced) onOpenAdvanced(tab);
    else window.location.assign(tab === "Vault" ? "/vault" : tab === "Disperse" ? "/disperse" : "/console");
  }

  async function loadCanonicalBurners(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    setBusy("Unlocking canonical Vault for its public wallet projection…");
    try {
      const raw = window.localStorage.getItem(LAUNCH_VAULT_STORAGE_KEY);
      if (!raw) throw new Error("No encrypted launch Vault exists in this browser. Create burners in Vault first.");
      const payload = await decryptLaunchVaultBackup(parseEncryptedLaunchVaultBackup(raw), vaultPassphrase);
      const projected = [...projectGuidedBurners(payload, "base"), ...projectGuidedBurners(payload, "ethereum")];
      if (projected.length === 0) throw new Error("The encrypted Vault has no ETH or Base wallets yet. Generate burners in Vault first.");
      const generated = projected.filter((wallet) => /^Burner\s+\d+$/i.test(wallet.label));
      const selected = generated.length > 0 ? generated : projected;
      setBurners(projected);
      setSelectedBurnerAddresses(selected.map((wallet) => wallet.address));
      setVaultPassphrase("");
      setReviewedQuantity(null);
      setFundingPlan(null);
      setPreflight(null);
      setSubmissions({});
      setVerifications([]);
      setNotice(`${projected.length} public burner address${projected.length === 1 ? "" : "es"} loaded. Private keys were discarded from this step.`);
      setStep("drop");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the encrypted launch Vault.");
    } finally {
      setBusy(null);
    }
  }

  function toggleBurner(address: string) {
    setSelectedBurnerAddresses((current) =>
      current.some((value) => value.toLowerCase() === address.toLowerCase())
        ? current.filter((value) => value.toLowerCase() !== address.toLowerCase())
        : [...current, address],
    );
    setReviewedQuantity(null);
    setFundingPlan(null);
    setPreflight(null);
    setSubmissions({});
    setVerifications([]);
  }

  async function scanDrop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    if (!query.trim()) {
      setError("Paste an OpenSea slug, collection URL, or public contract address.");
      return;
    }
    if (chainKey !== "base" && chainKey !== "ethereum") {
      setError("The minimal holder guide supports Base and Ethereum. Use Advanced tools for operator-configured chains.");
      return;
    }
    setBusy("Reading public drop configuration…");
    try {
      const params = new URLSearchParams({ q: query.trim(), chain: chainKey });
      const response = await fetch(`/api/mints/discover?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as MintDiscoveryResponse | MintDiscoveryError;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Drop scan failed." : body.error);
      requireExecutablePublicStage(body);
      setDiscovery(body);
      setReviewedQuantity(null);
      setFundingPlan(null);
      setPreflight(null);
      setSubmissions({});
      setVerifications([]);
      setSimulations([]);
      setNotice("Executable public SeaDrop stage read onchain. Review the exact funding rows next.");
      setStep("funding-review");
    } catch (err) {
      setDiscovery(null);
      setError(err instanceof Error ? err.message : "Could not scan this drop.");
    } finally {
      setBusy(null);
    }
  }

  function reviewFunding() {
    resetMessages();
    if (!holder || !discovery) {
      setError("Verified holder and drop scan are required before funding review.");
      return;
    }
    try {
      const plan = buildGuidedFundingReview({
        holder,
        discovery,
        burners: selectedBurners,
        quantityPerBurner,
        mintGasLimit: BigInt(mintGasLimit),
        maxFeePerGasWei: parseUnits(maxFeeGwei, "gwei"),
        bufferBps: Math.round(Number(bufferPercent) * 100),
        maxTotalSourceWei: parseEther(maxTotalEth),
      });
      setReviewedQuantity(quantityPerBurner);
      setFundingPlan(plan);
      setPreflight(null);
      setFundingConsent({});
      setSubmissions({});
      setVerifications([]);
      setNotice("Exact per-burner values are ready. Nothing was sent.");
      setStep("funding");
    } catch (err) {
      setReviewedQuantity(null);
      setFundingPlan(null);
      setError(err instanceof Error ? err.message : "Could not build the funding review.");
    }
  }

  async function checkHolderFunding() {
    resetMessages();
    if (!fundingPlan) return;
    setBusy("Checking connected holder, chain, and balance…");
    try {
      const provider = getBrowserProvider();
      await provider.request({ method: "eth_requestAccounts" });
      const checked = await checkConnectedHolderFundingPreflight(provider, fundingPlan);
      setPreflight(checked);
      if (!checked.ready) throw new Error("Connected-holder preflight is blocked. Review the failed checks below.");
      setNotice("Connected holder preflight passed. Each transfer still needs its own checkbox and wallet confirmation.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connected-holder preflight failed.");
    } finally {
      setBusy(null);
    }
  }

  async function submitFunding(transactionId: string) {
    resetMessages();
    if (!fundingPlan || !preflight) return;
    setBusy(`Requesting explicit wallet confirmation for ${transactionId}…`);
    try {
      const submission = await submitConnectedHolderFundingTransaction({
        provider: getBrowserProvider(),
        plan: fundingPlan,
        preflight,
        transactionId,
        explicitConsent: Boolean(fundingConsent[transactionId]),
        priorVerifications: verifications,
      });
      setSubmissions((current) => ({ ...current, [transactionId]: submission }));
      setFundingConsent((current) => ({ ...current, [transactionId]: false }));
      setNotice(`${transactionId} submitted. Verify its receipt and burner balance before the next transfer.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Funding request failed.");
    } finally {
      setBusy(null);
    }
  }

  async function verifyFunding(transactionId: string) {
    resetMessages();
    if (!fundingPlan || !submissions[transactionId]) return;
    setBusy(`Verifying ${transactionId} receipt and recipient balance…`);
    try {
      const verification = await verifyConnectedHolderFundingTransaction({
        provider: getBrowserProvider(),
        plan: fundingPlan,
        submission: submissions[transactionId],
      });
      setVerifications((current) => [...current.filter((row) => row.transactionId !== transactionId), verification]);
      if (!verification.verified) throw new Error("Receipt or burner balance is not verified yet. No later transfer is unlocked.");
      setNotice(`${transactionId} verified. The next transfer may now be reviewed explicitly.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Funding verification failed.");
    } finally {
      setBusy(null);
    }
  }

  async function simulateMint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    if (!holder || !discovery || !fundingPlan || !fundingComplete || reviewedQuantity === null) {
      setError("Every explicit funding row must have a verified receipt and burner balance before simulation.");
      return;
    }
    setBusy("Unlocking Vault in memory and simulating holder-routed mints…");
    try {
      const raw = window.localStorage.getItem(LAUNCH_VAULT_STORAGE_KEY);
      if (!raw) throw new Error("Canonical encrypted launch Vault is missing from this browser.");
      const payload = await decryptLaunchVaultBackup(parseEncryptedLaunchVaultBackup(raw), simulationPassphrase);
      const preview = buildGuidedMintSimulationPlan({
        holder,
        discovery,
        vault: payload,
        burnerAddresses: fundingPlan.transactions.map((row) => row.to),
        quantityPerBurner: reviewedQuantity,
        maxTotalValueWei: fundingPlan.totals.mintPriceWei,
      });
      const next: BrowserPreparedMint[] = [];
      for (const transaction of preview.plan.transactions) {
        next.push(await simulatePreparedBrowserMint(transaction));
        setSimulations([...next]);
      }
      setSimulationPassphrase("");
      const failed = next.filter((transaction) => transaction.status === "failed").length;
      if (failed > 0) throw new Error(`${failed} simulation${failed === 1 ? "" : "s"} failed. No mint broadcast is available in this guided preview.`);
      setNotice("All holder-routed mint simulations passed. No mint transaction was signed or broadcast.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mint simulation failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`${embedded ? "" : "min-h-screen bg-[var(--compas-bg-art)] p-4 sm:p-6"} text-[color:var(--compas-ink)]`}>
      <div className="mx-auto grid max-w-5xl gap-4">
        <header className="rounded-[2rem] border border-[color:var(--compas-line)] bg-[color:var(--compas-hero)] p-5 text-[color:var(--compas-hero-ink)] sm:p-7">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[color:var(--compas-hero-muted)]">Holder mint guide · preview</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">One launch decision at a time.</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold text-[color:var(--compas-hero-muted)]">Verified holder funds each burner explicitly. Mints route back to the holder and stop at simulation.</p>
          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.14em]">
            <span className="rounded-full border border-[color:var(--compas-hero-line)] px-3 py-1.5">No automatic funding</span>
            <span className="rounded-full border border-[color:var(--compas-hero-line)] px-3 py-1.5">Recipient · verified holder</span>
            <span className="rounded-full border border-[color:var(--compas-hero-line)] px-3 py-1.5">No mint broadcast</span>
          </div>
        </header>

        <nav className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Guided holder flow">
          {GUIDED_HOLDER_STEPS.map((item, index) => {
            const available = index <= maxReachableIndex;
            const active = step === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={!available}
                onClick={() => setStep(item.id)}
                className={`rounded-2xl border px-3 py-3 text-left transition ${active ? "border-[color:var(--compas-accent)] bg-[color:var(--compas-accent)] text-[color:var(--compas-accent-ink)]" : "border-[color:var(--compas-line)] bg-[color:var(--compas-card)] text-[color:var(--compas-muted)]"} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="text-[10px] font-black uppercase tracking-[0.18em]">0{index + 1}</span>
                <span className="mt-1 block text-sm font-black">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {notice ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</p> : null}
        {error ? <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
        {busy ? <p className="rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm font-black text-violet-700">{busy}</p> : null}

        {step === "holder" ? (
          <div className={CARD}>
            <StepHeading number="01" title="Connect verified Compas" body="The signed holder session is the funding source and final NFT recipient." />
            {holder ? (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-[color:var(--compas-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-sm font-black">{maskVaultAddress(holder.address)}</p>
                  <p className="mt-1 text-xs font-bold text-[color:var(--compas-muted)]">{holder.compasCount} Compas · server verified</p>
                </div>
                <button type="button" onClick={() => setStep("burners")} className="rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)]">Continue</button>
              </div>
            ) : <p className="mt-4 text-sm font-bold text-[color:var(--compas-muted)]">Waiting for the holder gate. Return to login if this does not resolve.</p>}
          </div>
        ) : null}

        {step === "burners" ? (
          <div className={CARD}>
            <StepHeading number="02" title="Create encrypted burners" body="Use the canonical production Vault. This guide reads only its public address projection." />
            <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr]">
              <button type="button" onClick={() => openAdvanced("Vault")} className="rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] px-5 py-3 text-sm font-black">Open Vault tools</button>
              <form onSubmit={loadCanonicalBurners} className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input type="password" value={vaultPassphrase} onChange={(event) => setVaultPassphrase(event.target.value)} placeholder="Vault passphrase" autoComplete="current-password" className={FIELD} />
                <button type="submit" disabled={Boolean(busy)} className="rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)] disabled:opacity-50">Load burner addresses</button>
              </form>
            </div>
            {burners.length > 0 ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {burners.map((wallet) => (
                  <label key={wallet.id} className="flex items-center gap-3 rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-3 text-sm font-bold">
                    <input type="checkbox" checked={selectedBurnerAddresses.includes(wallet.address)} onChange={() => toggleBurner(wallet.address)} />
                    <span className="min-w-0"><span className="block font-black">{wallet.label}</span><span className="block truncate font-mono text-xs text-[color:var(--compas-muted)]">{maskVaultAddress(wallet.address)} · {wallet.chain}</span></span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "drop" ? (
          <div className={CARD}>
            <StepHeading number="03" title="Choose or scan a drop" body="Only an executable public SeaDrop stage can continue." />
            <form onSubmit={scanDrop} className="mt-4 grid gap-2 sm:grid-cols-[1fr_150px_auto]">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="OpenSea slug, URL, or 0x contract" className={FIELD} />
              <select value={chainKey} onChange={(event) => setChainKey(event.target.value)} className={FIELD}><option value="base">Base</option><option value="ethereum">Ethereum</option></select>
              <button type="submit" disabled={Boolean(busy)} className="rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)] disabled:opacity-50">Scan drop</button>
            </form>
          </div>
        ) : null}

        {step === "funding-review" && discovery ? (
          <div className={CARD}>
            <StepHeading number="04" title="Review exact funding" body={`${discovery.collection.name} · ${requireExecutablePublicStage(discovery).priceEth} ETH each before gas and buffer.`} />
            <div className="mt-4 grid gap-3 sm:grid-cols-5">
              <NumberInput label="Quantity / burner" value={quantityPerBurner} onChange={setQuantityPerBurner} min={1} />
              <NumberInput label="Mint gas limit" value={mintGasLimit} onChange={setMintGasLimit} min={21_000} />
              <TextInput label="Max fee gwei" value={maxFeeGwei} onChange={setMaxFeeGwei} />
              <TextInput label="Buffer %" value={bufferPercent} onChange={setBufferPercent} />
              <TextInput label="Holder cap ETH" value={maxTotalEth} onChange={setMaxTotalEth} />
            </div>
            <button type="button" onClick={reviewFunding} className="mt-4 w-full rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)]">Review exact funding</button>
          </div>
        ) : null}

        {step === "funding" && fundingPlan ? (
          <div className={CARD}>
            <StepHeading number="05" title="Fund one burner at a time" body={`Holder source total ceiling: ${formatEther(fundingPlan.totals.sourceTotalWei)} ETH. No transfer is automatic.`} />
            <button type="button" onClick={checkHolderFunding} disabled={Boolean(busy)} className="mt-4 rounded-2xl border border-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent)] disabled:opacity-50">Check connected holder</button>
            {preflight ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{preflight.checks.map((check) => <p key={check.id} className={`rounded-2xl border p-3 text-xs font-bold ${check.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>{check.ok ? "✓" : "✕"} {check.label}<span className="mt-1 block font-mono font-semibold">{check.detail}</span></p>)}</div> : null}
            <div className="mt-4 grid gap-3">
              {fundingPlan.transactions.map((row) => {
                const submission = submissions[row.id];
                const verification = verifications.find((item) => item.transactionId === row.id);
                const previousReady = fundingPlan.transactions.slice(0, row.index).every((previous) => verifications.some((item) => item.transactionId === previous.id && item.verified));
                return (
                  <article key={row.id} className="rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div><p className="font-black">Transfer {row.index + 1} · {maskVaultAddress(row.to)}</p><p className="mt-1 font-mono text-xs text-[color:var(--compas-muted)]">{formatEther(row.fundingValueWei)} ETH + transfer gas ceiling</p></div>
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">{verification?.verified ? "verified" : submission ? "receipt pending" : "not sent"}</span>
                    </div>
                    {!submission ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <label className="flex items-start gap-2 rounded-2xl bg-[color:var(--compas-card)] p-3 text-xs font-bold"><input type="checkbox" checked={Boolean(fundingConsent[row.id])} onChange={(event) => setFundingConsent((current) => ({ ...current, [row.id]: event.target.checked }))} /><span>I reviewed this recipient and exact value. Ask my connected holder wallet to confirm this transfer only.</span></label>
                        <button type="button" onClick={() => submitFunding(row.id)} disabled={!preflight?.ready || !previousReady || !fundingConsent[row.id] || Boolean(busy)} className="rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)] disabled:cursor-not-allowed disabled:opacity-40">Confirm transfer {row.index + 1}</button>
                      </div>
                    ) : !verification?.verified ? (
                      <button type="button" onClick={() => verifyFunding(row.id)} disabled={Boolean(busy)} className="mt-3 rounded-2xl border border-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent)]">Verify receipt & balance</button>
                    ) : null}
                  </article>
                );
              })}
            </div>
            {fundingComplete ? <button type="button" onClick={() => setStep("simulate")} className="mt-4 w-full rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)]">Continue to simulation</button> : null}
          </div>
        ) : null}

        {step === "simulate" ? (
          <div className={CARD}>
            <StepHeading number="06" title="Simulate holder-routed mints" body="Burners pay. The verified Compas holder receives every NFT. This guided surface has no mint broadcast." />
            <form onSubmit={simulateMint} className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
              <input type="password" value={simulationPassphrase} onChange={(event) => setSimulationPassphrase(event.target.value)} placeholder="Vault passphrase" autoComplete="current-password" className={FIELD} />
              <button type="submit" disabled={!fundingComplete || Boolean(busy)} className="rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)] disabled:cursor-not-allowed disabled:opacity-40">Simulate mint</button>
            </form>
            {simulations.length > 0 ? <div className="mt-4 grid gap-2">{simulations.map((transaction) => <p key={transaction.id} className="rounded-2xl bg-[color:var(--compas-soft)] p-3 text-sm font-bold">{maskVaultAddress(transaction.walletAddress)} → {maskVaultAddress(transaction.recipientAddress)} · {transaction.status}{transaction.simulationGas ? ` · ${transaction.simulationGas} gas` : ""}</p>)}</div> : null}
          </div>
        ) : null}

        <details className="rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-card)] p-4">
          <summary className="cursor-pointer text-sm font-black">Advanced</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => openAdvanced("Vault")} className="rounded-xl border border-[color:var(--compas-line)] px-4 py-2 text-xs font-black">Open Vault tools</button>
            <button type="button" onClick={() => openAdvanced("Mints")} className="rounded-xl border border-[color:var(--compas-line)] px-4 py-2 text-xs font-black">Open CLI planner</button>
            <button type="button" onClick={() => openAdvanced("Disperse")} className="rounded-xl border border-[color:var(--compas-line)] px-4 py-2 text-xs font-black">Open Disperse draft</button>
          </div>
          <p className="mt-2 text-xs font-semibold text-[color:var(--compas-muted)]">Private-key import, bulk tools, CLI exports, and generic disperse drafts stay outside the guided holder path.</p>
        </details>
      </div>
    </section>
  );
}

function StepHeading({ number, title, body }: { number: string; title: string; body: string }) {
  return <div><p className="text-xs font-black uppercase tracking-[0.22em] text-[color:var(--compas-accent)]">{number}</p><h2 className="mt-1 text-2xl font-black">{title}</h2><p className="mt-2 text-sm font-semibold text-[color:var(--compas-muted)]">{body}</p></div>;
}

function NumberInput({ label, value, onChange, min }: { label: string; value: number; onChange: (value: number) => void; min: number }) {
  return <label className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">{label}<input type="number" min={min} value={value} onChange={(event) => onChange(Number(event.target.value))} className={`${FIELD} mt-2 normal-case tracking-normal`} /></label>;
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">{label}<input inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} className={`${FIELD} mt-2 normal-case tracking-normal`} /></label>;
}

function getBrowserProvider(): Eip1193Provider {
  const ethereum = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (!ethereum) throw new Error("No connected browser wallet was found. Open this page in a wallet browser or install MetaMask/Rabby.");
  return ethereum;
}
