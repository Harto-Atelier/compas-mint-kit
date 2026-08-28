"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { JsonRpcProvider, formatEther, parseEther, parseUnits } from "ethers";

import {
  LAUNCH_VAULT_STORAGE_KEY,
  decryptLaunchVaultBackup,
  maskVaultAddress,
  parseEncryptedLaunchVaultBackup,
  type LaunchVaultPayload,
  type LaunchVaultPublicWallet,
} from "@/lib/encrypted-launch-vault";
import {
  GUIDED_HOLDER_STEPS,
  assessGuidedFinish,
  buildGuidedFundingReview,
  buildGuidedMintSimulationPlan,
  checkGuidedExecutionCapabilities,
  projectGuidedBurners,
  readGuidedBurnerBalances,
  requireExecutablePublicStage,
  resolveGuidedHolderStep,
  type GuidedExecutionCapabilities,
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
import {
  broadcastPreparedBrowserMint,
  broadcastSignedMintViaRpc,
  createSubmittedMintReceipt,
  invalidateBrowserMintTransactions,
  markGuidedMintReceiptsForReconciliation,
  markSignedMintBroadcastViaFastPath,
  mergeGuidedMintReceipts,
  pollPreparedBrowserMintReceipt,
  prepareLowLatencyBrowserMint,
  revokePreparedBrowserMintSigners,
  signPreparedBrowserMint,
  simulatePreparedBrowserMint,
  type BrowserMintPlan,
  type BrowserPreparedMint,
  type BrowserSignedMint,
  type GuidedMintReceipt,
} from "@/lib/browser-broadcast";
import { fireSignedMintsViaRelay } from "@/lib/low-latency-relay-client";
import {
  classifyGuidedRelayFireError,
  classifyGuidedRelayFireResult,
  decideGuidedFastPathAction,
  describeGuidedFastPathTiming,
  formatGuidedFastPathTiming,
  guidedFastPathLaunchId,
  resolveGuidedRelayUrl,
  shouldUseGuidedFastPath,
  type GuidedFastPathFireOutcome,
  type GuidedFastPathTiming,
} from "@/lib/guided-fast-path";
import {
  GUIDED_HOLDER_RECOVERY_STORAGE_KEY,
  buildGuidedHolderRecoveryJournal,
  parseGuidedHolderRecoveryJournal,
  readGuidedHolderRecoveryJournal,
  rehydrateGuidedRecoveryBalancePlan,
  rehydrateGuidedRecoveryTransactions,
  writeGuidedHolderRecoveryJournal,
  type GuidedHolderRecoveryJournal,
} from "@/lib/guided-holder-recovery";
import type { MintDiscoveryError, MintDiscoveryResponse } from "@/lib/mint-types";
import type { OpenSeaDropCard as GuidedFeedDrop, OpenSeaDropsFeedResult } from "@/lib/opensea-drops-feed";
import { createLaunchVaultGenerationGuard, subscribeToLaunchVaultLifecycle } from "@/lib/launch-vault-lifecycle";
import {
  blockscoutTxUrl,
  humanizeMintError,
  relayHealthLabel,
  relayHealthStatusFromPayload,
  type HumanMintFlowStatus,
  type RelayHealthBadgeStatus,
} from "@/lib/low-latency-human-ux";

type AdvancedTab = "Vault" | "Mints" | "Disperse";

type GuidedHolderFlowProps = {
  embedded?: boolean;
  onOpenAdvanced?: (tab: AdvancedTab) => void;
};

const FIELD = "h-11 w-full rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-card)] px-3 text-sm font-bold text-[color:var(--compas-ink)] outline-none focus:border-[color:var(--compas-accent)]";
const CARD = "rounded-[1.75rem] border border-[color:var(--compas-line)] bg-[color:var(--compas-card)] p-4 sm:p-5";
// The human execution-mode surface is ON by default; set NEXT_PUBLIC_GUIDED_EXECUTION_MODE_SURFACE to "0"/"false" to hide it.
const GUIDED_EXECUTION_MODE_SURFACE_ENABLED = process.env.NEXT_PUBLIC_GUIDED_EXECUTION_MODE_SURFACE !== "0" && process.env.NEXT_PUBLIC_GUIDED_EXECUTION_MODE_SURFACE !== "false";
const GUIDED_RELAY_URL = resolveGuidedRelayUrl(process.env.NEXT_PUBLIC_COMPAS_RELAY_URL ?? null);

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function timingKeyOf(transaction: Pick<BrowserPreparedMint, "binding" | "id">): string {
  return `${transaction.binding}:${transaction.id}`;
}

export default function GuidedHolderFlow({ embedded = false, onOpenAdvanced }: GuidedHolderFlowProps) {
  const [holder, setHolder] = useState<CompasGateSession | null>(null);
  const [step, setStep] = useState<GuidedHolderStepId>("holder");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [unlockedVault, setUnlockedVault] = useState<LaunchVaultPayload | null>(null);
  const [burners, setBurners] = useState<LaunchVaultPublicWallet[]>([]);
  const [selectedBurnerAddresses, setSelectedBurnerAddresses] = useState<string[]>([]);

  const [query, setQuery] = useState("");
  const [chainKey, setChainKey] = useState("base");
  const [discovery, setDiscovery] = useState<MintDiscoveryResponse | null>(null);
  const [feedDrops, setFeedDrops] = useState<GuidedFeedDrop[] | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [quantityPerBurner, setQuantityPerBurner] = useState(1);
  const [mintGasLimit, setMintGasLimit] = useState(250_000);
  const [maxFeeGwei, setMaxFeeGwei] = useState("0.08");
  const [bufferPercent, setBufferPercent] = useState("0");
  const [mintValueMaxEth, setMintValueMaxEth] = useState("0.25");
  const [holderFundingCapEth, setHolderFundingCapEth] = useState("0.30");
  const [setupComplete, setSetupComplete] = useState(false);
  const [reviewedQuantity, setReviewedQuantity] = useState<number | null>(null);
  const [fundingPlan, setFundingPlan] = useState<BurnerFundingPlan | null>(null);
  const [executionPlan, setExecutionPlan] = useState<BrowserMintPlan | null>(null);
  const [executionCapabilities, setExecutionCapabilities] = useState<GuidedExecutionCapabilities | null>(null);
  const [preflight, setPreflight] = useState<ConnectedHolderFundingPreflight | null>(null);
  const [fundingConsent, setFundingConsent] = useState<Record<string, boolean>>({});
  const [submissions, setSubmissions] = useState<Record<string, ConnectedHolderFundingSubmission>>({});
  const [verifications, setVerifications] = useState<ConnectedHolderFundingVerification[]>([]);

  const [transactions, setTransactions] = useState<BrowserPreparedMint[]>([]);
  const [expectedTransactionCount, setExpectedTransactionCount] = useState<number | null>(null);
  const [liveConsentOpen, setLiveConsentOpen] = useState(false);
  const [liveConsent, setLiveConsent] = useState(false);
  const [liveConsentBinding, setLiveConsentBinding] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<GuidedMintReceipt[]>([]);
  const [receiptPolling, setReceiptPolling] = useState(false);
  const [mintTimings, setMintTimings] = useState<Record<string, GuidedFastPathTiming>>({});
  const [humanFlow, setHumanFlow] = useState<{ status: HumanMintFlowStatus; updatedAt: string } | null>(null);
  const [burnerBalances, setBurnerBalances] = useState<Record<string, bigint | null>>({});
  const [finished, setFinished] = useState(false);
  const [recoveryJournal, setRecoveryJournal] = useState<GuidedHolderRecoveryJournal | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return readGuidedHolderRecoveryJournal(window.localStorage);
    } catch {
      return null;
    }
  });
  const [recoveryBalances, setRecoveryBalances] = useState<Record<string, bigint | null>>({});
  const vaultGeneration = useRef(createLaunchVaultGenerationGuard());
  const relayHealth = useRelayHealth();

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

  useEffect(() => subscribeToLaunchVaultLifecycle(window, () => {
    vaultGeneration.current.invalidate();
    setUnlockedVault(null);
    setVaultPassphrase("");
    setBurners([]);
    setSelectedBurnerAddresses([]);
    setTransactions((current) => {
      return invalidateBrowserMintTransactions(current);
    });
    setReceipts((current) => markGuidedMintReceiptsForReconciliation(current));
    setExecutionPlan((current) => {
      if (current) revokePreparedBrowserMintSigners(current.transactions);
      return null;
    });
    setReviewedQuantity(null);
    setSetupComplete(false);
    setFundingPlan(null);
    setExecutionCapabilities(null);
    setPreflight(null);
    setFundingConsent({});
    setSubmissions({});
    setVerifications([]);
    setBurnerBalances({});
    setFinished(false);
    setLiveConsent(false);
    setLiveConsentOpen(false);
    setLiveConsentBinding(null);
    setBusy(null);
    setNotice("The encrypted browser Vault changed. Funding authority, capabilities, preflight, consents, and signer state were revoked. Submitted hashes remain in the recovery journal and require receipt reconciliation.");
  }), []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== GUIDED_HOLDER_RECOVERY_STORAGE_KEY) return;
      try {
        setRecoveryJournal(event.newValue ? parseGuidedHolderRecoveryJournal(event.newValue) : null);
      } catch {
        setError("A recovery journal from another tab failed validation and was ignored.");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const selectedBurners = useMemo(
    () => burners.filter((wallet) => selectedBurnerAddresses.some((address) => address.toLowerCase() === wallet.address.toLowerCase())),
    [burners, selectedBurnerAddresses],
  );
  const fundingComplete = useMemo(
    () => Boolean(fundingPlan) && fundingPlan!.transactions.every((row) => verifications.some((verification) => verification.transactionId === row.id && verification.verified)),
    [fundingPlan, verifications],
  );
  const simulationComplete = transactions.length > 0 && transactions.every((transaction) => transaction.status === "simulated" || transaction.status === "broadcast");
  const broadcastComplete = transactions.length > 0 && transactions.every((transaction) => transaction.status === "broadcast" || transaction.broadcastAttempted === true);
  const receiptsComplete = transactions.length > 0 && receipts.length === transactions.length && receipts.every((receipt) => receipt.status === "Confirmed" || receipt.status === "Failed");
  const confirmedReceipts = receipts.filter((receipt) => receipt.status === "Confirmed");
  const finishAssessment = useMemo(
    () => holder ? assessGuidedFinish({ holderAddress: holder.address, expectedTransactionCount: expectedTransactionCount ?? 0, transactions, receipts, burnerBalances }) : null,
    [holder, expectedTransactionCount, transactions, receipts, burnerBalances],
  );
  const readiness = {
    holder: Boolean(holder),
    burners: selectedBurners.length > 0,
    setup: setupComplete,
    drop: Boolean(discovery),
    fundingReview: Boolean(fundingPlan && executionCapabilities?.ready),
    fundingComplete,
    simulationComplete,
    broadcastComplete,
    receiptsComplete,
  };
  const recommendedStep = resolveGuidedHolderStep(readiness);
  const maxReachableIndex = GUIDED_HOLDER_STEPS.findIndex((item) => item.id === recommendedStep);
  const currentStepIndex = Math.max(0, GUIDED_HOLDER_STEPS.findIndex((item) => item.id === step));
  const currentStep = GUIDED_HOLDER_STEPS[currentStepIndex];

  useEffect(() => {
    if (step !== "receipts" || receiptPolling || !receipts.some((receipt) => receipt.status === "Submitted" || receipt.status === "Confirming" || receipt.status === "Unknown")) return;
    const timer = window.setTimeout(() => void pollMintReceipts(), 3_000);
    return () => window.clearTimeout(timer);
    // Receipt polling is deliberately the only repeated network action; it never signs or sends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, receipts, receiptPolling, transactions]);

  useEffect(() => {
    if (step !== "drop" || feedDrops !== null) return;
    let cancelled = false;
    const startTimer = window.setTimeout(() => {
      if (cancelled) return;
      setFeedLoading(true);
      fetch(`/api/mints/opensea-drops?mode=live&limit=12`, { cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json()) as OpenSeaDropsFeedResult | { ok: false; error?: string };
          if (!response.ok || !body.ok) throw new Error(("error" in body && body.error) || "Live mints unavailable right now.");
          if (!cancelled) setFeedDrops(body.items);
        })
        .catch((err) => {
          if (!cancelled) setFeedError(err instanceof Error ? err.message : "Live mints unavailable right now.");
        })
        .finally(() => {
          if (!cancelled) setFeedLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
    };
  }, [step, feedDrops]);

  function resetMessages() {
    setNotice(null);
    setError(null);
  }

  function updateHumanFlow(status: HumanMintFlowStatus) {
    setHumanFlow({ status, updatedAt: new Date().toLocaleString() });
  }

  function showHumanError(errorValue: unknown) {
    const human = humanizeMintError(errorValue);
    updateHumanFlow("No completado");
    setError(human.message);
    if (human.returnToReview) setStep("mint");
  }

  function openAdvanced(tab: AdvancedTab) {
    if (onOpenAdvanced) onOpenAdvanced(tab);
    else window.location.assign(tab === "Vault" ? "/vault" : tab === "Disperse" ? "/disperse" : "/console");
  }

  function persistRecoveryEvidence(input: {
    plan: BrowserMintPlan;
    transactionRows: readonly BrowserPreparedMint[];
    receiptRows: readonly GuidedMintReceipt[];
    fundingRows: readonly ConnectedHolderFundingSubmission[];
  }): GuidedHolderRecoveryJournal | null {
    if (!holder || !discovery) return null;
    try {
      const journal = buildGuidedHolderRecoveryJournal({
        plan: input.plan,
        collection: { address: discovery.collection.address, name: discovery.collection.name },
        recipient: holder.address,
        transactions: input.transactionRows,
        receipts: input.receiptRows,
        fundingSubmissions: input.fundingRows,
      });
      writeGuidedHolderRecoveryJournal(window.localStorage, journal);
      setRecoveryJournal(journal);
      return journal;
    } catch (journalError) {
      setError(`Recovery evidence could not be saved: ${journalError instanceof Error ? journalError.message : "unknown journal error"}`);
      return null;
    }
  }

  function clearBoundRun() {
    vaultGeneration.current.invalidate();
    revokePreparedBrowserMintSigners(transactions);
    if (executionPlan) revokePreparedBrowserMintSigners(executionPlan.transactions);
    setReviewedQuantity(null);
    setSetupComplete(false);
    setExpectedTransactionCount(null);
    setFundingPlan(null);
    setExecutionPlan(null);
    setExecutionCapabilities(null);
    setPreflight(null);
    setFundingConsent({});
    setSubmissions({});
    setVerifications([]);
    setTransactions([]);
    setReceipts([]);
    setMintTimings({});
    setHumanFlow(null);
    setBurnerBalances({});
    setLiveConsent(false);
    setLiveConsentOpen(false);
    setLiveConsentBinding(null);
    setFinished(false);
  }

  async function loadCanonicalBurners(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();
    setBusy("Unlocking the encrypted Vault in this browser run…");
    const unlockGeneration = vaultGeneration.current.invalidate();
    try {
      const raw = window.localStorage.getItem(LAUNCH_VAULT_STORAGE_KEY);
      if (!raw) throw new Error("No encrypted launch Vault exists in this browser. Create burners in Vault first.");
      const payload = await decryptLaunchVaultBackup(parseEncryptedLaunchVaultBackup(raw), vaultPassphrase);
      if (
        !vaultGeneration.current.isCurrent(unlockGeneration) ||
        window.localStorage.getItem(LAUNCH_VAULT_STORAGE_KEY) !== raw
      ) throw new Error("The encrypted browser Vault changed while unlock was pending.");
      const projected = [...projectGuidedBurners(payload, "base"), ...projectGuidedBurners(payload, "ethereum")];
      if (projected.length === 0) throw new Error("The encrypted Vault has no ETH or Base wallets yet. Generate burners in Vault first.");
      const generated = projected.filter((wallet) => /^Burner\s+\d+$/i.test(wallet.label));
      const selected = generated.length > 0 ? generated : projected;
      clearBoundRun();
      setUnlockedVault(payload);
      setBurners(projected);
      setSelectedBurnerAddresses(selected.map((wallet) => wallet.address));
      setVaultPassphrase("");
      setNotice(`${projected.length} burner address${projected.length === 1 ? "" : "es"} loaded. Signers stay only in memory for this exact guided run and are never displayed.`);
      setStep("setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the encrypted launch Vault.");
    } finally {
      setBusy(null);
    }
  }

  function toggleBurner(address: string) {
    clearBoundRun();
    setSelectedBurnerAddresses((current) =>
      current.some((value) => value.toLowerCase() === address.toLowerCase())
        ? current.filter((value) => value.toLowerCase() !== address.toLowerCase())
        : [...current, address],
    );
  }

  async function scanDrop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await performDropScan(query, chainKey);
  }

  async function performDropScan(rawQuery: string, rawChainKey: string) {
    resetMessages();
    if (!rawQuery.trim()) {
      setError("Paste an OpenSea slug, collection URL, or public contract address.");
      return;
    }
    if (rawChainKey !== "base" && rawChainKey !== "ethereum") {
      setError("The holder guide supports Base and Ethereum. Advanced tools cover operator-configured chains.");
      return;
    }
    setBusy("Reading public drop configuration…");
    try {
      const params = new URLSearchParams({ q: rawQuery.trim(), chain: rawChainKey });
      const response = await fetch(`/api/mints/discover?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as MintDiscoveryResponse | MintDiscoveryError;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Drop scan failed." : body.error);
      requireExecutablePublicStage(body);
      clearBoundRun();
      setDiscovery(body);
      setNotice("Executable public SeaDrop stage read onchain. Funding stays locked until the exact mint and receipt path passes capability checks.");
      setStep("funding-review");
    } catch (err) {
      setDiscovery(null);
      setError(err instanceof Error ? err.message : "Could not scan this drop.");
    } finally {
      setBusy(null);
    }
  }

  function selectFeedDrop(drop: GuidedFeedDrop) {
    const feedChain = drop.chain.toLowerCase() === "ethereum" ? "ethereum" : drop.chain.toLowerCase() === "base" ? "base" : null;
    if (!feedChain) {
      setError("This drop is on an unsupported chain. The guide covers Base and Ethereum.");
      return;
    }
    const value = drop.slug || drop.contractAddress;
    setQuery(value);
    setChainKey(feedChain);
    void performDropScan(value, feedChain);
  }

  async function reviewFunding() {
    resetMessages();
    if (!holder || !discovery || !unlockedVault) {
      setError("Verified holder, unlocked Vault, and drop scan are required before funding review.");
      return;
    }
    clearBoundRun();
    const reviewGeneration = vaultGeneration.current.begin();
    setBusy("Binding funding, mint recipient, spend maximum, signers, and receipt reads…");
    try {
      const funding = buildGuidedFundingReview({
        holder,
        discovery,
        burners: selectedBurners,
        quantityPerBurner,
        mintGasLimit: BigInt(mintGasLimit),
        maxFeePerGasWei: parseUnits(maxFeeGwei, "gwei"),
        bufferBps: Math.round(Number(bufferPercent) * 100),
        maxTotalSourceWei: parseEther(holderFundingCapEth),
      });
      const mintValueMaxWei = parseEther(mintValueMaxEth);
      const preview = buildGuidedMintSimulationPlan({
        holder,
        discovery,
        vault: unlockedVault,
        burnerAddresses: funding.transactions.map((row) => row.to),
        quantityPerBurner,
        maxTotalValueWei: mintValueMaxWei,
        mintGasLimit,
        maxFeePerGasWei: parseUnits(maxFeeGwei, "gwei"),
      });
      const capabilities = await checkGuidedExecutionCapabilities({
        plan: preview.plan,
        holderAddress: holder.address,
        burnerAddresses: funding.transactions.map((row) => row.to),
        mintValueMaxWei,
      });
      if (!vaultGeneration.current.isCurrent(reviewGeneration)) {
        revokePreparedBrowserMintSigners(preview.plan.transactions);
        return;
      }
      if (!funding.review.readyForFunding) throw new Error("Holder funding authorization ceiling is below the reviewed funding rows and transfer gas maximum.");
      if (!capabilities.ready) {
        revokePreparedBrowserMintSigners(preview.plan.transactions);
        throw new Error(`Funding remains locked: ${capabilities.checks.filter((check) => !check.ok).map((check) => check.label).join(", ")}.`);
      }
      setReviewedQuantity(quantityPerBurner);
      setExpectedTransactionCount(preview.plan.transactions.length);
      setFundingPlan(funding);
      setExecutionPlan(preview.plan);
      setExecutionCapabilities(capabilities);
      setTransactions(preview.plan.transactions);
      persistRecoveryEvidence({ plan: preview.plan, transactionRows: [], receiptRows: [], fundingRows: [] });
      setNotice("Exact funding and live mint rows are bound to the same in-memory signers. Nothing was sent.");
      setStep("funding");
    } catch (err) {
      if (vaultGeneration.current.isCurrent(reviewGeneration)) setError(err instanceof Error ? err.message : "Could not build a complete funding-to-receipt run.");
    } finally {
      if (vaultGeneration.current.isCurrent(reviewGeneration)) setBusy(null);
    }
  }

  async function checkHolderFunding() {
    resetMessages();
    if (!fundingPlan || !executionCapabilities?.ready) return;
    const fundingPreflightGeneration = vaultGeneration.current.begin();
    setBusy("Checking connected holder, chain, and balance…");
    try {
      const provider = getBrowserProvider();
      await provider.request({ method: "eth_requestAccounts" });
      if (!vaultGeneration.current.isCurrent(fundingPreflightGeneration)) return;
      const checked = await checkConnectedHolderFundingPreflight(provider, fundingPlan);
      if (!vaultGeneration.current.isCurrent(fundingPreflightGeneration)) return;
      setPreflight(checked);
      if (!checked.ready) throw new Error("Connected-holder preflight is blocked. Review the failed checks below.");
      setNotice("Connected holder preflight passed. Each transfer still needs its own checkbox and wallet confirmation.");
    } catch (err) {
      if (vaultGeneration.current.isCurrent(fundingPreflightGeneration)) setError(err instanceof Error ? err.message : "Connected-holder preflight failed.");
    } finally {
      if (vaultGeneration.current.isCurrent(fundingPreflightGeneration)) setBusy(null);
    }
  }

  async function submitFunding(transactionId: string) {
    resetMessages();
    if (!fundingPlan || !preflight || !executionCapabilities?.ready) return;
    const fundingGeneration = vaultGeneration.current.begin();
    setBusy(`Requesting explicit wallet confirmation for ${transactionId}…`);
    try {
      const submission = await submitConnectedHolderFundingTransaction({
        provider: authorityCheckedFundingProvider(getBrowserProvider(), () => vaultGeneration.current.isCurrent(fundingGeneration)),
        plan: fundingPlan,
        preflight,
        transactionId,
        explicitConsent: Boolean(fundingConsent[transactionId]),
        priorVerifications: verifications,
      });
      const nextSubmissions = { ...submissions, [transactionId]: submission };
      if (executionPlan) persistRecoveryEvidence({
        plan: executionPlan,
        transactionRows: transactions,
        receiptRows: receipts,
        fundingRows: Object.values(nextSubmissions),
      });
      if (!vaultGeneration.current.isCurrent(fundingGeneration)) {
        setNotice(`${transactionId} returned a hash after Vault invalidation. It was journaled for reconciliation; funding authority remains revoked.`);
        return;
      }
      setSubmissions(nextSubmissions);
      setFundingConsent((current) => ({ ...current, [transactionId]: false }));
      setNotice(`${transactionId} submitted. Verify its receipt and burner balance before the next transfer.`);
    } catch (err) {
      if (vaultGeneration.current.isCurrent(fundingGeneration)) setError(err instanceof Error ? err.message : "Funding request failed.");
    } finally {
      if (vaultGeneration.current.isCurrent(fundingGeneration)) setBusy(null);
    }
  }

  async function verifyFunding(transactionId: string) {
    resetMessages();
    if (!fundingPlan || !submissions[transactionId]) return;
    const verificationGeneration = vaultGeneration.current.begin();
    setBusy(`Verifying ${transactionId} receipt and recipient balance…`);
    try {
      const verification = await verifyConnectedHolderFundingTransaction({
        provider: getBrowserProvider(),
        plan: fundingPlan,
        submission: submissions[transactionId],
      });
      if (!vaultGeneration.current.isCurrent(verificationGeneration)) return;
      setVerifications((current) => [...current.filter((row) => row.transactionId !== transactionId), verification]);
      if (!verification.verified) throw new Error("Receipt or burner balance is not verified yet. No later transfer is unlocked.");
      setNotice(`${transactionId} verified. The next transfer may now be reviewed explicitly.`);
    } catch (err) {
      if (vaultGeneration.current.isCurrent(verificationGeneration)) setError(err instanceof Error ? err.message : "Funding verification failed.");
    } finally {
      if (vaultGeneration.current.isCurrent(verificationGeneration)) setBusy(null);
    }
  }

  async function simulateMint() {
    resetMessages();
    if (!holder || !executionPlan || !fundingComplete || reviewedQuantity === null || !executionCapabilities?.ready) {
      setError("The complete bound run and every verified funding row are required before simulation.");
      return;
    }
    const simulationGeneration = vaultGeneration.current.begin();
    setBusy("Simulating the exact holder-routed mint rows…");
    const next = [...transactions];
    for (const [index, transaction] of next.entries()) {
      if (transaction.status === "broadcast" || transaction.broadcastAttempted) continue;
      const simulated = await simulatePreparedBrowserMint(transaction);
      if (!vaultGeneration.current.isCurrent(simulationGeneration)) {
        revokePreparedBrowserMintSigners([simulated]);
        setBusy(null);
        return;
      }
      next[index] = simulated;
      setTransactions([...next]);
    }
    if (!vaultGeneration.current.isCurrent(simulationGeneration)) return;
    setTransactions(next);
    setBusy(null);
    const failed = next.filter((transaction) => transaction.status === "failed").length;
    if (failed > 0) {
      setError(`${failed} simulation${failed === 1 ? "" : "s"} failed. No live mint consent is available. Review the error; no transaction was sent.`);
      return;
    }
    setNotice("Every exact bound row simulated successfully. Review explicit final live mint consent next.");
    updateHumanFlow("Preparado");
    setStep("mint");
  }

  function openLiveConsent() {
    if (!executionPlan || !simulationComplete || transactions.some((transaction) => transaction.binding !== executionPlan.binding)) return;
    setLiveConsent(false);
    setLiveConsentBinding(executionPlan.binding);
    setLiveConsentOpen(true);
  }

  async function broadcastMints() {
    resetMessages();
    if (!executionPlan || !liveConsent || liveConsentBinding !== executionPlan.binding) {
      setError("Live mint consent no longer matches the exact simulated plan. Review it again.");
      return;
    }
    const broadcastGeneration = vaultGeneration.current.begin();
    // Close and consume the visible consent before the first await. The library also
    // consumes signer authority synchronously so a second invocation cannot send.
    setLiveConsentOpen(false);
    setLiveConsent(false);
    setLiveConsentBinding(null);
    updateHumanFlow("Firmado");
    // The low-latency fast path is the standard mode; the direct RPC path stays as the safe fallback.
    const fastPath = shouldUseGuidedFastPath({ relayUrl: GUIDED_RELAY_URL, health: relayHealth.status }) && GUIDED_RELAY_URL
      ? { relayUrl: GUIDED_RELAY_URL, launchId: guidedFastPathLaunchId(discovery?.collection.address), chainId: executionPlan.chain.chainId }
      : null;
    setBusy("Signing and sending each exact row once…");
    const next = [...transactions];
    const nextReceipts: GuidedMintReceipt[] = [...receipts];
    const nextTimings: Record<string, GuidedFastPathTiming> = { ...mintTimings };
    try {
      for (const [index, transaction] of next.entries()) {
        if (transaction.status === "broadcast" || transaction.broadcastAttempted) continue;
        if (!vaultGeneration.current.isCurrent(broadcastGeneration)) throw new Error("Vault authority changed before this row was sent. No automatic retry was attempted.");
        const { sent, timing } = await executeGuidedMintRow(transaction, {
          fastPath,
          planBinding: executionPlan.binding,
          isAuthorityCurrent: () => vaultGeneration.current.isCurrent(broadcastGeneration),
        });
        next[index] = sent;
        if (timing) nextTimings[timingKeyOf(sent)] = timing;
        const receiptUpdate = sent.status === "broadcast"
          ? createSubmittedMintReceipt(sent)
          : {
            transactionId: sent.id,
            binding: sent.binding,
            hash: sent.hash ?? "",
            status: "Failed" as const,
            confirmations: 0,
            error: sent.error ?? "Browser broadcast failed before a valid transaction hash was returned.",
          };
        const mergedReceipts = mergeGuidedMintReceipts(nextReceipts, [receiptUpdate]);
        if (sent.status === "broadcast") updateHumanFlow("Enviado");
        else updateHumanFlow("No completado");
        nextReceipts.splice(0, nextReceipts.length, ...mergedReceipts);
        setTransactions([...next]);
        setReceipts([...nextReceipts]);
        setMintTimings({ ...nextTimings });
        persistRecoveryEvidence({
          plan: executionPlan,
          transactionRows: next,
          receiptRows: nextReceipts,
          fundingRows: Object.values(submissions),
        });
        if (!vaultGeneration.current.isCurrent(broadcastGeneration)) {
          throw new Error("Vault authority changed after submission. The captured receipt remains visible; no additional row was sent.");
        }
      }
      if (next.some((transaction) => transaction.status === "failed")) {
        showHumanError("Vía rápida no disponible — puedes reintentar");
      } else {
        setNotice("Submitted once. Receipt polling now verifies confirmations and NFT mints to the holder.");
      }
    } catch (err) {
      if (vaultGeneration.current.isCurrent(broadcastGeneration)) {
        showHumanError(err);
      }
    } finally {
      if (vaultGeneration.current.isCurrent(broadcastGeneration)) {
        setTransactions(next);
        setReceipts(nextReceipts);
        setBusy(null);
      } else {
        setTransactions((current) => {
          const retained = invalidateBrowserMintTransactions(next);
          const byKey = new Map(current.map((transaction) => [`${transaction.binding}:${transaction.id}`, transaction]));
          for (const transaction of retained) byKey.set(`${transaction.binding}:${transaction.id}`, transaction);
          return [...byKey.values()];
        });
        setReceipts((current) => markGuidedMintReceiptsForReconciliation(mergeGuidedMintReceipts(current, nextReceipts)));
      }
      setStep(nextReceipts.length > 0 ? "receipts" : "mint");
    }
  }

  /**
   * Execute one guided mint row. Standard mode is the low-latency fast path:
   * prepare exact nonce/gas/EIP-1559 fields, sign locally in memory, then FIRE
   * through the fast path. If the fast path is unavailable before signing, the
   * row uses the existing direct RPC broadcast. If signed bytes exist but fast
   * acceptance was not proven, the exact same bytes are rebroadcast over direct
   * RPC (same hash — no double mint), so no signed row is ever left in limbo.
   */
  async function executeGuidedMintRow(
    transaction: BrowserPreparedMint,
    deps: {
      fastPath: { relayUrl: string; launchId: string; chainId: number } | null;
      planBinding: string;
      isAuthorityCurrent: () => boolean;
    },
  ): Promise<{ sent: BrowserPreparedMint; timing?: GuidedFastPathTiming }> {
    if (!deps.fastPath) {
      const directStart = nowMs();
      const sent = await broadcastPreparedBrowserMint(transaction, {
        explicitConsent: true,
        consentBinding: deps.planBinding,
        isAuthorityCurrent: deps.isAuthorityCurrent,
      });
      return { sent, timing: { route: "direct", sendMs: nowMs() - directStart } };
    }

    let signed: BrowserSignedMint | null = null;
    let outcome: GuidedFastPathFireOutcome = "network-failed";
    let signMs: number | undefined;
    let fireMs: number | undefined;
    try {
      const provider = new JsonRpcProvider(transaction.rpcUrl);
      const [network, nonce, feeData] = await Promise.all([
        provider.getNetwork(),
        provider.getTransactionCount(transaction.walletAddress, "pending"),
        provider.getFeeData(),
      ]);
      if (BigInt(network.chainId) !== BigInt(transaction.chain.chainId)) {
        throw new Error(`RPC chain ID ${network.chainId.toString()} does not match expected ${transaction.chain.chainId}.`);
      }
      if (!deps.isAuthorityCurrent()) throw new Error("Vault authority changed before this row was signed. No transaction was sent.");
      const boundMaxFee = transaction.request.maxFeePerGas ?? feeData.maxFeePerGas ?? undefined;
      const boundGasLimit = transaction.request.gasLimit ?? (transaction.simulationGas ? (BigInt(transaction.simulationGas) * BigInt(12)) / BigInt(10) : undefined);
      if (boundMaxFee === undefined || boundGasLimit === undefined) throw new Error("Prepared gas limit and maximum fee are required before the fast path.");
      const suggestedPriority = feeData.maxPriorityFeePerGas ?? boundMaxFee;
      const prepared = prepareLowLatencyBrowserMint(transaction, {
        nonce,
        gasLimit: boundGasLimit,
        maxFeePerGas: boundMaxFee,
        maxPriorityFeePerGas: suggestedPriority < boundMaxFee ? suggestedPriority : boundMaxFee,
      });
      const signStart = nowMs();
      signed = await signPreparedBrowserMint(prepared, {
        explicitConsent: true,
        consentBinding: deps.planBinding,
        lowLatencyBinding: prepared.lowLatencyBinding,
      });
      signMs = nowMs() - signStart;
      if (!deps.isAuthorityCurrent()) throw new Error("Vault authority changed before this row was sent. No transaction was sent.");
      const fireStart = nowMs();
      const results = await fireSignedMintsViaRelay({
        relayUrl: deps.fastPath.relayUrl,
        launchId: deps.fastPath.launchId,
        chainId: deps.fastPath.chainId,
        planBinding: deps.planBinding,
        signedMints: [signed],
      });
      fireMs = nowMs() - fireStart;
      outcome = classifyGuidedRelayFireResult(results[0]);
    } catch (fastPathError) {
      outcome = classifyGuidedRelayFireError(fastPathError);
    }

    const action = decideGuidedFastPathAction({ outcome, hasSignedBytes: signed !== null });
    if (action === "fallback-direct") {
      // Nothing was signed for this row yet — the standard direct path signs and sends once.
      const directStart = nowMs();
      const sent = await broadcastPreparedBrowserMint(transaction, {
        explicitConsent: true,
        consentBinding: deps.planBinding,
        isAuthorityCurrent: deps.isAuthorityCurrent,
      });
      return { sent, timing: { route: "direct", sendMs: nowMs() - directStart } };
    }
    if (action === "confirm-fast" && signed) {
      return {
        sent: markSignedMintBroadcastViaFastPath(signed),
        timing: { route: "fast", signMs, sendMs: fireMs ?? 0 },
      };
    }
    // Signed bytes exist but acceptance is unproven: rebroadcast the exact same
    // bytes (same hash) over direct RPC so the row always terminates.
    const rebroadcastStart = nowMs();
    const sent = await broadcastSignedMintViaRpc(signed!);
    return { sent, timing: { route: "fast", signMs, sendMs: (fireMs ?? 0) + (nowMs() - rebroadcastStart) } };
  }

  async function pollMintReceipts() {
    if (receiptPolling) return;
    setReceiptPolling(true);
    const current = receipts.map((receipt) => (
      receipt.status === "Submitted" || receipt.status === "Unknown"
        ? { ...receipt, status: "Confirming" as const }
        : receipt
    ));
    setReceipts(current);
    const next = [...current];
    for (const [index, receipt] of next.entries()) {
      if (receipt.status !== "Confirming") continue;
      const transaction = transactions.find((candidate) => candidate.id === receipt.transactionId && candidate.binding === receipt.binding);
      if (!transaction) {
        next[index] = { ...receipt, status: "Failed", error: "Receipt row no longer matches the cryptographically bound submitted plan." };
        continue;
      }
      next[index] = await pollPreparedBrowserMintReceipt(transaction, receipt);
      setReceipts([...next]);
    }
    setReceipts(next);
    setReceiptPolling(false);
    if (executionPlan) persistRecoveryEvidence({
      plan: executionPlan,
      transactionRows: transactions,
      receiptRows: next,
      fundingRows: Object.values(submissions),
    });
    if (next.length === transactions.length && next.every((receipt) => receipt.status === "Confirmed")) {
      updateHumanFlow("Confirmado");
      setNotice("Every receipt is confirmed and every NFT recipient is verified as the Compas holder.");
    } else if (next.some((receipt) => receipt.status === "Failed")) {
      updateHumanFlow("No completado");
    }
  }

  async function resumeRecoveryReceipts() {
    resetMessages();
    if (!recoveryJournal || receiptPolling) return;
    setReceiptPolling(true);
    try {
      const recoveryTransactions = rehydrateGuidedRecoveryTransactions(recoveryJournal);
      const next: GuidedMintReceipt[] = [];
      for (const transaction of recoveryTransactions) {
        const existing = recoveryJournal.receipts.find((receipt) => (
          receipt.transactionId === transaction.id &&
          receipt.binding === transaction.binding &&
          receipt.hash.toLowerCase() === transaction.hash?.toLowerCase()
        ));
        if (existing?.status === "Failed") {
          next.push(existing);
          continue;
        }
        const recoverable = existing
          ? { ...existing, status: "Unknown" as const }
          : createSubmittedMintReceipt(transaction);
        next.push(await pollPreparedBrowserMintReceipt(transaction, recoverable));
      }
      const updated = parseGuidedHolderRecoveryJournal(JSON.stringify({
        ...recoveryJournal,
        updatedAt: new Date().toISOString(),
        receipts: next,
      }));
      writeGuidedHolderRecoveryJournal(window.localStorage, updated);
      setRecoveryJournal(updated);
      setNotice("Recovery journal receipts were reconciled from chain state. No transaction was signed, sent, retried, or swept.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery receipt reconciliation failed and remains retryable.");
    } finally {
      setReceiptPolling(false);
    }
  }

  async function recheckRecoveryBalances() {
    resetMessages();
    if (!recoveryJournal) return;
    setBusy("Rechecking exact residual burner balances on the journal chain…");
    try {
      const balances = await readGuidedBurnerBalances(rehydrateGuidedRecoveryBalancePlan(recoveryJournal));
      setRecoveryBalances(balances);
      setNotice("Residual balances were refreshed. Any nonzero burner remains blocked until a separately reviewed manual exact sweep is confirmed and its residual balance is rechecked.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Residual balance reconciliation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function checkBurnerBalances() {
    resetMessages();
    if (!executionPlan) return;
    setBusy("Checking every burner balance before finish…");
    try {
      const balances = await readGuidedBurnerBalances(executionPlan);
      setBurnerBalances(balances);
      const hasUnknown = Object.values(balances).some((balance) => balance === null);
      const hasFunds = Object.values(balances).some((balance) => balance !== null && balance !== BigInt(0));
      if (hasUnknown || hasFunds) setError("Finish remains blocked. Unknown or nonzero burner balances require the manual exact sweep recovery flow.");
      else setNotice("Every burner balance is verified at zero. Safe finish can now drop in-memory signer state.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Burner balance reconciliation failed.");
    } finally {
      setBusy(null);
    }
  }

  function finishSafely() {
    resetMessages();
    if (!finishAssessment?.ready) {
      setError("Finish is blocked until every mint is confirmed to the holder and every burner balance is verified at zero.");
      return;
    }
    revokePreparedBrowserMintSigners(transactions);
    setUnlockedVault(null);
    setFinished(true);
    setNotice("Finished safely. In-memory signer authority was dropped. The encrypted Vault backup and verified receipts were not wiped.");
  }

  const networkGasMaxWei = fundingPlan ? fundingPlan.totals.mintGasWei + fundingPlan.totals.sourceTransferGasWei : BigInt(0);
  const mintNetworkGasMaxWei = executionPlan?.transactions.reduce(
    (total, transaction) => total + (transaction.request.gasLimit ?? BigInt(0)) * (transaction.request.maxFeePerGas ?? BigInt(0)),
    BigInt(0),
  ) ?? BigInt(0);

  return (
    <section className={`${embedded ? "" : "min-h-screen bg-[var(--compas-bg-art)] p-4 sm:p-6"} text-[color:var(--compas-ink)]`}>
      <div className="mx-auto grid max-w-5xl gap-4">
        <header className="rounded-[2rem] border border-[color:var(--compas-line)] bg-[color:var(--compas-hero)] p-5 text-[color:var(--compas-hero-ink)] sm:p-7">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[color:var(--compas-hero-muted)]">Compas mint kit</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Mint, calmly.</h1>
          <p className="mt-2 max-w-xl text-sm font-semibold text-[color:var(--compas-hero-muted)]">One step. One decision. Your Compas wallet receives the NFT.</p>
          <details className="mt-4 rounded-2xl border border-dashed border-[color:var(--compas-hero-line)] bg-[color:var(--compas-hero-card)] p-3">
            <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.16em] text-[color:var(--compas-hero-muted)]">Holder guide</summary>
            <p className="mt-2 text-xs font-semibold text-[color:var(--compas-hero-muted)]">Optional guardrails for the guided path. They stay collapsed so the next mint action remains primary.</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.14em]">
              <span className="rounded-full border border-[color:var(--compas-hero-line)] px-3 py-1.5">No automatic funding</span>
              <span className="rounded-full border border-[color:var(--compas-hero-line)] px-3 py-1.5">Recipient · verified holder</span>
              <span className="rounded-full border border-[color:var(--compas-hero-line)] px-3 py-1.5">Explicit live consent</span>
            </div>
          </details>
        </header>

        <div className="rounded-2xl border-2 border-[color:var(--compas-accent)] bg-[color:var(--compas-card)] p-4 sm:hidden" aria-live="polite">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[color:var(--compas-accent)]">Current step · {String(currentStepIndex + 1).padStart(2, "0")} of {GUIDED_HOLDER_STEPS.length}</p>
          <p className="mt-1 text-xl font-black">{currentStep.label}</p>
        </div>

        <details className="rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-3 text-xs">
          <summary className="cursor-pointer font-black text-[color:var(--compas-muted)]">All steps</summary>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 lg:grid-cols-9" aria-label="Guided holder flow">
            {GUIDED_HOLDER_STEPS.map((item, index) => {
              const available = index <= maxReachableIndex || (item.id === "finish" && broadcastComplete);
              const active = step === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!available}
                  onClick={() => setStep(item.id)}
                  className={`min-w-24 shrink-0 rounded-xl border px-3 py-2 text-left transition sm:min-w-0 ${active ? "border-[color:var(--compas-accent)] bg-[color:var(--compas-accent)] text-[color:var(--compas-accent-ink)]" : "border-[color:var(--compas-line)] bg-[color:var(--compas-card)] text-[color:var(--compas-muted)]"} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <span className="text-[10px] font-black uppercase tracking-[0.18em]">{String(index + 1).padStart(2, "0")}</span>
                  <span className="mt-1 block text-xs font-black">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </details>

        {notice ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</p> : null}
        {error ? <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
        {busy ? <p className="rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm font-black text-violet-700">{busy}</p> : null}

        {recoveryJournal ? (
          <details className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-amber-950">
            <summary className="cursor-pointer text-sm font-black">Browser recovery journal · {recoveryJournal.collection.name}</summary>
            <p className="mt-2 text-xs font-bold">Secret-free local evidence survives refresh and tab changes. It cannot sign, send, or retry transactions.</p>
            <div className="mt-3 grid gap-2 text-xs font-bold sm:grid-cols-2">
              <p>Chain · {recoveryJournal.chain.name} ({recoveryJournal.chain.chainId})</p>
              <p>Collection · {recoveryJournal.collection.name} · {maskVaultAddress(recoveryJournal.collection.address)}</p>
              <p>Verified recipient · {maskVaultAddress(recoveryJournal.recipient)}</p>
              <p>Captured mint hashes · {recoveryJournal.mintTransactions.length}/{recoveryJournal.expectedTransactionCount}</p>
              <p className="break-all font-mono sm:col-span-2">Plan binding · {recoveryJournal.planBinding}</p>
            </div>
            {recoveryJournal.fundingTransactions.length > 0 ? <div className="mt-3 grid gap-1">{recoveryJournal.fundingTransactions.map((row) => <p key={`${row.transactionId}:${row.hash}`} className="break-all font-mono text-xs font-bold">Funding · {row.transactionId} · {row.hash}</p>)}</div> : null}
            {recoveryJournal.mintTransactions.length > 0 ? <div className="mt-3 grid gap-1">{recoveryJournal.mintTransactions.map((transaction) => { const receipt = recoveryJournal.receipts.find((candidate) => candidate.transactionId === transaction.id && candidate.hash.toLowerCase() === transaction.hash.toLowerCase()); return <p key={transaction.hash} className="break-all font-mono text-xs font-bold">Mint · {receipt?.status ?? "Submitted"} · {transaction.hash}</p>; })}</div> : null}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => void resumeRecoveryReceipts()} disabled={receiptPolling || recoveryJournal.mintTransactions.length === 0} className="rounded-xl border border-amber-700 px-4 py-2 text-xs font-black disabled:opacity-40">Resume receipt reconciliation</button>
              <button type="button" onClick={() => void recheckRecoveryBalances()} disabled={Boolean(busy) || recoveryJournal.burnerAddresses.length === 0} className="rounded-xl border border-amber-700 px-4 py-2 text-xs font-black disabled:opacity-40">Recheck residual balances</button>
            </div>
            <div className="mt-4 rounded-xl border border-amber-300 bg-white p-3">
              <p className="text-xs font-black uppercase tracking-[0.14em]">Manual exact sweep</p>
              <p className="mt-2 text-xs font-bold">For each burner separately: re-read exact balance and nonce; bind gas limit and maximum fee; set value to balance minus that maximum gas fee; simulate only to the verified holder; consent for that burner; send sequentially; verify the receipt and then the residual balance. Never sweep or retry automatically.</p>
              <div className="mt-2 grid gap-1">{recoveryJournal.burnerAddresses.map((address) => { const balanceKey = Object.keys(recoveryBalances).find((candidate) => candidate.toLowerCase() === address.toLowerCase()); const balance = balanceKey ? recoveryBalances[balanceKey] : undefined; return <p key={address} className="font-mono text-xs font-bold">{maskVaultAddress(address)} · {balance === undefined ? "balance not rechecked" : balance === null ? "balance unknown" : `${formatEther(balance)} ETH`}</p>; })}</div>
              <button type="button" onClick={() => openAdvanced("Vault")} className="mt-3 w-full rounded-xl bg-amber-800 px-4 py-2 text-xs font-black text-white">Open encrypted Vault for manual recovery</button>
            </div>
          </details>
        ) : null}

        {step === "holder" ? (
          <div className={CARD}>
            <StepHeading number="01" title="Connect" body="Verify your Compas wallet." />
            {holder ? (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-[color:var(--compas-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-mono text-sm font-black">{maskVaultAddress(holder.address)}</p><p className="mt-1 text-xs font-bold text-[color:var(--compas-muted)]">Verified</p></div>
                <button type="button" onClick={() => setStep("burners")} className="rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)]">Continue</button>
              </div>
            ) : <p className="mt-4 text-sm font-bold text-[color:var(--compas-muted)]">Waiting for the holder gate. Return to login if this does not resolve.</p>}
          </div>
        ) : null}

        {step === "burners" ? (
          <div className={CARD}>
            <StepHeading number="02" title="Prepare wallets" body="Use temporary wallets for payment. NFT goes to you." />
            <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr]">
              <button type="button" onClick={() => openAdvanced("Vault")} className="rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] px-5 py-3 text-sm font-black">Create temporary mint wallets</button>
              <form onSubmit={loadCanonicalBurners} className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input type="password" value={vaultPassphrase} onChange={(event) => setVaultPassphrase(event.target.value)} placeholder="Backup passphrase" autoComplete="current-password" className={FIELD} />
                <button type="submit" disabled={Boolean(busy)} className="rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)] disabled:opacity-50">Load wallets for this mint</button>
              </form>
            </div>
            {burners.length > 0 ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{burners.map((wallet) => <label key={wallet.id} className="flex items-center gap-3 rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-3 text-sm font-bold"><input type="checkbox" checked={selectedBurnerAddresses.includes(wallet.address)} onChange={() => toggleBurner(wallet.address)} /><span className="min-w-0"><span className="block font-black">{wallet.label}</span><span className="block truncate font-mono text-xs text-[color:var(--compas-muted)]">{maskVaultAddress(wallet.address)} · {wallet.chain}</span></span></label>)}</div> : null}
          </div>
        ) : null}

        {step === "setup" ? (
          <div className={CARD}>
            <StepHeading number="03" title="Setup" body="Choose quantity, spend, and distribution." />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <NumberInput label="Quantity / wallet" value={quantityPerBurner} onChange={(value) => { clearBoundRun(); setQuantityPerBurner(value); }} min={1} />
              <TextInput label="Maximum spend" value={mintValueMaxEth} onChange={(value) => { clearBoundRun(); setMintValueMaxEth(value); }} />
            </div>
            <details className="mt-4 rounded-2xl border border-dashed border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-3">
              <summary className="cursor-pointer text-xs font-black text-[color:var(--compas-muted)]">More options</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <NumberInput label="Mint gas limit" value={mintGasLimit} onChange={(value) => { clearBoundRun(); setMintGasLimit(value); }} min={21_000} />
                <TextInput label="Max fee gwei" value={maxFeeGwei} onChange={(value) => { clearBoundRun(); setMaxFeeGwei(value); }} />
                <TextInput label="Buffer %" value={bufferPercent} onChange={(value) => { clearBoundRun(); setBufferPercent(value); }} />
                <TextInput label="Funding cap ETH" value={holderFundingCapEth} onChange={(value) => { clearBoundRun(); setHolderFundingCapEth(value); }} />
              </div>
            </details>
            <button type="button" onClick={() => { setSetupComplete(true); setStep("drop"); }} className="mt-4 w-full rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)]">Continue</button>
          </div>
        ) : null}

        {step === "drop" ? (
          <div className={CARD}>
            <StepHeading number="04" title="Select mint" body="Tap a live mint, or paste a link below." />
            {feedLoading ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-3xl bg-[color:var(--compas-soft)]" />)}</div> : null}
            {!feedLoading && feedError && !feedDrops?.length ? <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">Live mints unavailable — paste a link below.</p> : null}
            {!feedLoading && feedDrops?.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {feedDrops.map((drop) => (
                  <button key={`${drop.chain}:${drop.contractAddress}`} type="button" disabled={Boolean(busy)} onClick={() => selectFeedDrop(drop)} className="group relative h-32 overflow-hidden rounded-3xl border border-[color:var(--compas-line)] bg-slate-900 text-left transition hover:-translate-y-0.5 hover:border-[color:var(--compas-accent)] disabled:opacity-60">
                    {drop.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={drop.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-75 transition group-hover:scale-105" />
                    ) : <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-950" />}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-3">
                      <p className="truncate text-sm font-black text-white">{drop.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase">
                        {drop.isMinting ? <span className="rounded-full border border-emerald-400 bg-emerald-400/15 px-2 py-0.5 text-emerald-300">Live</span> : null}
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-200">{drop.chain}</span>
                        {drop.mintPriceEth !== null ? <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-slate-200">{drop.mintPriceEth} ETH</span> : null}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            <details className="mt-4 rounded-2xl border border-dashed border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-3" open={!feedLoading && !feedDrops?.length}>
              <summary className="cursor-pointer text-xs font-black text-[color:var(--compas-muted)]">Or paste a mint link</summary>
              <form onSubmit={scanDrop} className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mint link or contract" className={FIELD} />
                <select value={chainKey} onChange={(event) => setChainKey(event.target.value)} className={FIELD}><option value="base">Base</option><option value="ethereum">Ethereum</option></select>
                <button type="submit" disabled={Boolean(busy)} className="rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)] disabled:opacity-50">Continue</button>
              </form>
            </details>
          </div>
        ) : null}

        {step === "funding-review" && discovery ? (
          <div className={CARD}>
            <StepHeading number="05" title="Confirm" body={`${discovery.collection.name} · ${requireExecutablePublicStage(discovery).priceEth} ETH each.`} />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-2xl border-2 border-[color:var(--compas-accent)] bg-[color:var(--compas-soft)] p-4 lg:col-span-2">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">Your setup</p>
                <p className="mt-2 text-lg font-black">{quantityPerBurner} per wallet · max {mintValueMaxEth} ETH</p>
                <p className="mt-2 text-xs font-bold text-[color:var(--compas-muted)]">NFT recipient: your verified Compas wallet.</p>
              </div>
              <div className="rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">Disclaimer</p>
                <p className="mt-2 text-sm font-bold text-[color:var(--compas-muted)]">Real mint can spend funds. You sign before anything is sent.</p>
              </div>
            </div>
            <button type="button" onClick={() => void reviewFunding()} disabled={Boolean(busy)} className="mt-4 w-full rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)] disabled:opacity-50">Continue</button>
          </div>
        ) : null}

        {step === "funding" && fundingPlan ? (
          <div className={CARD}>
            <StepHeading number="06" title="Fund" body="Send only what this mint needs." />
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Metric label="Maximum mint value" value={`${formatEther(executionPlan?.maxTotalWei ?? BigInt(0))} ETH`} prominent />
              <Metric label="Network gas estimate / max" value={`${formatEther(networkGasMaxWei)} ETH`} />
              <Metric label="Funding buffer" value={`${formatEther(fundingPlan.totals.bufferWei)} ETH`} />
            </div>
            <details className="mt-3 rounded-2xl border border-dashed border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-3"><summary className="cursor-pointer text-xs font-black text-[color:var(--compas-muted)]">Funding details</summary><p className="mt-2 text-xs font-bold text-[color:var(--compas-muted)]">Holder funding cap: {formatEther(fundingPlan.totals.sourceTotalWei)} ETH.</p>{executionCapabilities ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{executionCapabilities.checks.map((check) => <p key={check.id} className={`rounded-2xl border p-3 text-xs font-bold ${check.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>{check.ok ? "✓" : "✕"} {check.label}<span className="mt-1 block font-mono font-semibold">{check.detail}</span></p>)}</div> : null}</details>
            <button type="button" onClick={() => void checkHolderFunding()} disabled={!executionCapabilities?.ready || Boolean(busy)} className="mt-4 rounded-2xl border border-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent)] disabled:opacity-50">Check connected holder</button>
            {preflight ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{preflight.checks.map((check) => <p key={check.id} className={`rounded-2xl border p-3 text-xs font-bold ${check.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>{check.ok ? "✓" : "✕"} {check.label}<span className="mt-1 block font-mono font-semibold">{check.detail}</span></p>)}</div> : null}
            <div className="mt-4 grid gap-3">{fundingPlan.transactions.map((row) => {
              const submission = submissions[row.id];
              const verification = verifications.find((item) => item.transactionId === row.id);
              const previousReady = fundingPlan.transactions.slice(0, row.index).every((previous) => verifications.some((item) => item.transactionId === previous.id && item.verified));
              return <article key={row.id} className="rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-black">Transfer {row.index + 1} · {maskVaultAddress(row.to)}</p><p className="mt-1 font-mono text-xs text-[color:var(--compas-muted)]">{formatEther(row.fundingValueWei)} ETH to burner; source transfer gas separate</p></div><span className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">{verification?.verified ? "verified" : submission ? "receipt pending" : "not sent"}</span></div>{!submission ? <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><label className="flex items-start gap-2 rounded-2xl bg-[color:var(--compas-card)] p-3 text-xs font-bold"><input type="checkbox" checked={Boolean(fundingConsent[row.id])} onChange={(event) => setFundingConsent((current) => ({ ...current, [row.id]: event.target.checked }))} /><span>I reviewed this burner and exact value. Ask my holder wallet to confirm this transfer only.</span></label><button type="button" onClick={() => void submitFunding(row.id)} disabled={!preflight?.ready || !previousReady || !fundingConsent[row.id] || !executionCapabilities?.ready || Boolean(busy)} className="rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)] disabled:cursor-not-allowed disabled:opacity-40">Confirm transfer {row.index + 1}</button></div> : !verification?.verified ? <button type="button" onClick={() => void verifyFunding(row.id)} disabled={Boolean(busy)} className="mt-3 rounded-2xl border border-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent)]">Verify receipt & balance</button> : null}</article>;
            })}</div>
            {fundingComplete ? <button type="button" onClick={() => setStep("simulate")} className="mt-4 w-full rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)]">Continue to exact simulation</button> : null}
          </div>
        ) : null}

        {step === "simulate" ? (
          <div className={CARD}>
            <StepHeading number="07" title="Check" body="Make sure the mint is ready before signing." />
            <button type="button" onClick={() => void simulateMint()} disabled={!fundingComplete || !executionPlan || Boolean(busy)} className="mt-4 w-full rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)] disabled:cursor-not-allowed disabled:opacity-40">Check mint</button>
            {transactions.length > 0 ? <TransactionRows transactions={transactions} receipts={receipts} /> : null}
          </div>
        ) : null}

        {step === "mint" ? (
          <div className={CARD}>
            <StepHeading number="08" title="Sign" body="Final review. Nothing moves until you approve." />
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><Metric label="Maximum spend" value={`${formatEther(executionPlan?.maxTotalWei ?? BigInt(0))} ETH`} prominent /><Metric label="Recipient" value={holder ? maskVaultAddress(holder.address) : "missing"} /></div>
            <FastPathReadiness status={relayHealth.status} updatedAt={relayHealth.updatedAt} />
            <ExecutionModeSurface simulationComplete={simulationComplete} humanFlow={humanFlow} />
            <TransactionRows transactions={transactions} receipts={receipts} timings={mintTimings} />
            <button type="button" onClick={openLiveConsent} disabled={!simulationComplete || Boolean(busy)} className="mt-4 w-full rounded-2xl bg-red-600 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">Review and sign</button>
          </div>
        ) : null}

        {step === "receipts" ? (
          <div className={CARD}>
            <StepHeading number="09" title="Receipt" body="See what completed." />
            <TransactionRows transactions={transactions} receipts={receipts} timings={mintTimings} />
            <button type="button" onClick={() => void pollMintReceipts()} disabled={receiptPolling || !receipts.some((receipt) => receipt.status === "Submitted" || receipt.status === "Confirming" || receipt.status === "Unknown")} className="mt-4 w-full rounded-2xl border border-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent)] disabled:opacity-40">{receiptPolling ? "Checking…" : "Check receipt"}</button>
            {confirmedReceipts.map((receipt) => <div key={receipt.transactionId} className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800"><p>Verified NFT recipient · {receipt.verifiedRecipient}</p><p className="mt-1 font-mono text-xs">Token {receipt.tokenIds?.join(", ")} · {receipt.confirmations} confirmation(s)</p></div>)}
            <button type="button" onClick={() => setStep("finish")} disabled={!broadcastComplete} className="mt-4 w-full rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)] disabled:opacity-40">Review safe finish</button>
          </div>
        ) : null}

        {step === "finish" ? (
          <div className={CARD}>
            <StepHeading number="10" title="Finish" body="Confirm nothing is left behind." />
            {finished ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><p className="text-xl font-black">Safe finish complete</p><p className="mt-2 text-sm font-bold">In-memory signers are gone. Verified receipt evidence remains visible in this session and the encrypted Vault was not wiped.</p></div> : (
              <>
                <button type="button" onClick={() => void checkBurnerBalances()} disabled={!executionPlan || Boolean(busy)} className="mt-4 w-full rounded-2xl border border-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent)] disabled:opacity-40">Check burner balances</button>
                <div className="mt-4 grid gap-2">{finishAssessment?.blockers.length ? finishAssessment.blockers.map((blocker) => <p key={blocker} className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">Blocked · {blocker}</p>) : <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">Receipts and balances pass the safe finish gate.</p>}</div>
                {finishAssessment?.recovery.required ? <div className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-amber-900"><p className="text-xs font-black uppercase tracking-[0.16em]">Manual exact sweep</p><p className="mt-2 text-sm font-bold">Recipient: verified holder {maskVaultAddress(finishAssessment.recovery.recipient)}</p><p className="mt-2 text-sm font-semibold">{finishAssessment.recovery.instruction}</p><div className="mt-3 grid gap-2">{finishAssessment.recovery.burners.map((burner) => <p key={burner.address} className="rounded-xl bg-white p-2 font-mono text-xs font-bold">{maskVaultAddress(burner.address)} · {burner.status}{burner.balanceWei !== null ? ` · ${formatEther(burner.balanceWei)} ETH` : ""}</p>)}</div><button type="button" onClick={() => openAdvanced("Vault")} className="mt-4 w-full rounded-2xl bg-amber-700 px-5 py-3 text-sm font-black text-white">Open encrypted Vault for manual recovery</button><p className="mt-2 text-xs font-bold">Nothing is sent here. Each burner requires an exact balance/nonce/gas/fee/value review, simulation, separate consent, receipt verification, and residual balance check; rotation stays blocked.</p></div> : null}
                <button type="button" onClick={finishSafely} disabled={!finishAssessment?.ready || Boolean(busy)} className="mt-4 w-full rounded-2xl bg-[color:var(--compas-accent)] px-5 py-3 text-sm font-black text-[color:var(--compas-accent-ink)] disabled:cursor-not-allowed disabled:opacity-40">Finish safely</button>
              </>
            )}
          </div>
        ) : null}

        {liveConsentOpen && executionPlan && discovery ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="guided-live-consent-title">
            <div className="max-h-[calc(100dvh-3rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-[2rem] border border-red-200 bg-white p-5 text-slate-950 shadow-2xl">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-red-600">Explicit final live mint consent</p>
              <h3 id="guided-live-consent-title" className="mt-2 text-2xl font-black">Sign and send {transactions.length} exact mint row(s)?</h3>
              <div className="mt-4 grid gap-2 rounded-2xl bg-slate-50 p-4 text-sm font-bold sm:grid-cols-2"><p>Chain · {executionPlan.chain.name} ({executionPlan.chain.chainId})</p><p>Collection · {discovery.collection.name}</p><p className="break-all font-mono text-xs sm:col-span-2">Collection address · {discovery.collection.address}</p><p>Maximum mint value · {formatEther(executionPlan.maxTotalWei ?? BigInt(0))} ETH</p><p>Maximum network gas · {formatEther(mintNetworkGasMaxWei)} ETH</p><p className="sm:col-span-2">Verified NFT recipient · {holder?.address}</p></div>
              <TransactionRows transactions={transactions} receipts={receipts} />
              <label className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800"><input type="checkbox" checked={liveConsent} onChange={(event) => setLiveConsent(event.target.checked)} className="mt-1" /><span>I reviewed the exact simulated plan, burner payers, named collection and address, verified holder recipient, maximum mint value, and numeric maximum network gas. Sign and send these rows once now.</span></label>
              <div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => { setLiveConsentOpen(false); setLiveConsent(false); setLiveConsentBinding(null); }} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black">Cancel</button><button type="button" onClick={() => void broadcastMints()} disabled={!liveConsent || liveConsentBinding !== executionPlan.binding || Boolean(busy)} className="rounded-2xl bg-red-600 px-5 py-3 text-sm font-black text-white disabled:opacity-40">Sign and send</button></div>
            </div>
          </div>
        ) : null}

        <details className="rounded-2xl border border-dashed border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-3 text-xs">
          <summary className="cursor-pointer font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">Optional advanced tools</summary>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => openAdvanced("Vault")} className="rounded-xl border border-[color:var(--compas-line)] px-3 py-2 text-xs font-black text-[color:var(--compas-muted)]">Open Vault tools</button><button type="button" onClick={() => openAdvanced("Mints")} className="rounded-xl border border-[color:var(--compas-line)] px-3 py-2 text-xs font-black text-[color:var(--compas-muted)]">Open CLI planner</button><button type="button" onClick={() => openAdvanced("Disperse")} className="rounded-xl border border-[color:var(--compas-line)] px-3 py-2 text-xs font-black text-[color:var(--compas-muted)]">Open Disperse draft</button></div>
          <p className="mt-2 text-xs font-semibold text-[color:var(--compas-muted)]">Optional only. Bulk and generic planning tools stay secondary and never replace the guided mint step above.</p>
        </details>
      </div>
    </section>
  );
}

function StepHeading({ number, title, body }: { number: string; title: string; body: string }) {
  return <div><p className="text-xs font-black uppercase tracking-[0.22em] text-[color:var(--compas-accent)]">{number}</p><h2 className="mt-1 text-2xl font-black">{title}</h2><p className="mt-2 text-sm font-semibold text-[color:var(--compas-muted)]">{body}</p></div>;
}

function Metric({ label, value, prominent = false }: { label: string; value: string | number; prominent?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${prominent ? "border-2 border-[color:var(--compas-accent)] bg-[color:var(--compas-soft)]" : "border-[color:var(--compas-line)] bg-[color:var(--compas-soft)]"}`}><p className="text-[10px] font-black uppercase tracking-[0.16em] text-[color:var(--compas-muted)]">{label}</p><p className="mt-1 text-lg font-black">{value}</p></div>;
}

function TransactionRows({ transactions, receipts, timings }: { transactions: BrowserPreparedMint[]; receipts: GuidedMintReceipt[]; timings?: Record<string, GuidedFastPathTiming> }) {
  return <div className="mt-4 grid gap-2">{transactions.map((transaction) => {
    const receipt = receipts.find((candidate) => candidate.transactionId === transaction.id && candidate.binding === transaction.binding);
    const humanStatus: HumanMintFlowStatus = receipt?.status === "Confirmed" ? "Confirmado" : receipt?.status === "Failed" || transaction.status === "failed" ? "No completado" : receipt || transaction.status === "broadcast" ? "Enviado" : transaction.status === "simulated" ? "Preparado" : "Preparado";
    const hash = receipt?.hash || transaction.hash;
    const timing = timings?.[timingKeyOf(transaction)];
    const timingBadge = transaction.status === "broadcast" || receipt ? formatGuidedFastPathTiming(timing) : null;
    const timingDetail = describeGuidedFastPathTiming(timing);
    return <article key={`${transaction.binding}:${transaction.id}`} className="rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-3 text-sm font-bold"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><p>{transaction.walletAlias} · {maskVaultAddress(transaction.walletAddress)} → {maskVaultAddress(transaction.recipientAddress)}</p><span className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em]">{timingBadge ? <span className="rounded-full border border-[color:var(--compas-accent)] px-2 py-0.5 normal-case tracking-normal text-[color:var(--compas-accent)]">{timingBadge}</span> : null}{humanStatus}</span></div><p className="mt-1 font-mono text-xs text-[color:var(--compas-muted)]">{formatEther(transaction.request.value)} ETH mint value{transaction.simulationGas ? ` · ${transaction.simulationGas} gas estimate` : ""}</p>{receipt?.status === "Confirmed" && hash ? <a href={blockscoutTxUrl(hash)} target="_blank" rel="noreferrer" className="mt-2 block break-all rounded-xl border border-[color:var(--compas-accent)] px-3 py-2 text-xs font-black text-[color:var(--compas-accent)]">Receipt · Blockscout</a> : null}{receipt?.error || transaction.error ? <p className="mt-2 text-xs font-bold text-red-700">{humanizeMintError(receipt?.error ?? transaction.error).message}</p> : null}<details className="mt-2"><summary className="cursor-pointer text-xs font-black text-[color:var(--compas-muted)]">Avanzado</summary>{timingDetail ? <p className="mt-1 font-mono text-[10px] text-[color:var(--compas-muted)]">{timingDetail}</p> : null}<p className="mt-1 break-all font-mono text-[10px] text-[color:var(--compas-muted)]">{hash ?? "No transaction hash yet"}</p></details></article>;
  })}</div>;
}

function FastPathReadiness({ status, updatedAt }: { status: RelayHealthBadgeStatus; updatedAt: string | null }) {
  const body = status === "active"
    ? "Vía rápida activa. Tu mint saldrá por el camino más veloz."
    : status === "degraded"
      ? "Vía rápida degradada. Tu mint sigue saliendo, algo más lento."
      : status === "loading"
        ? "Comprobando la vía rápida…"
        : "Vía rápida no disponible. Tu mint saldrá por el camino estándar.";
  return (
    <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-4 sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[color:var(--compas-accent)]">Vía rápida</p>
        <p className="mt-1 text-sm font-bold text-[color:var(--compas-muted)]">{body}</p>
        {updatedAt ? <p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">Última comprobación · {updatedAt}</p> : null}
      </div>
      <RelayHealthBadge />
    </div>
  );
}

function StatusLegend({ status }: { status: HumanMintFlowStatus }) {
  return <span className="rounded-full border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] px-3 py-1.5">{status}</span>;
}

function ExecutionModeSurface({ simulationComplete, humanFlow }: { simulationComplete: boolean; humanFlow: { status: HumanMintFlowStatus; updatedAt: string } | null }) {
  if (!GUIDED_EXECUTION_MODE_SURFACE_ENABLED || !simulationComplete) return null;

  const steps: HumanMintFlowStatus[] = ["Preparado", "Firmado", "Enviado", "Confirmado"];
  const activeIndex = humanFlow ? steps.indexOf(humanFlow.status) : 0;

  return (
    <section className="mt-4 rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-4" aria-label="Vía rápida">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[color:var(--compas-accent)]">Vía rápida</p>
          <p className="mt-1 text-sm font-bold text-[color:var(--compas-muted)]">Firma una vez. Después mira el estado y el recibo.</p>
        </div>
        <RelayHealthBadge />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {steps.map((status, index) => {
          const isDone = humanFlow?.status === "Confirmado" || (activeIndex >= 0 && index <= activeIndex && humanFlow?.status !== "No completado");
          const isCurrent = humanFlow?.status === status;
          return <div key={status} className={`rounded-2xl border p-3 ${isCurrent ? "border-2 border-[color:var(--compas-accent)] bg-[color:var(--compas-card)]" : "border-[color:var(--compas-line)] bg-[color:var(--compas-card)]"}`}><p className="text-sm font-black">{status}</p><p className="mt-1 text-[10px] font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">{isDone ? "Listo" : "Pendiente"}</p></div>;
        })}
      </div>
      {humanFlow ? <p className="mt-3 text-xs font-bold text-[color:var(--compas-muted)]">Última actualización: {humanFlow.updatedAt}</p> : null}
      {humanFlow?.status === "No completado" ? <p className="mt-3 rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-card)] p-3 text-sm font-black text-red-700">No completado</p> : null}
      <details className="mt-3 rounded-2xl border border-[color:var(--compas-line)] bg-[color:var(--compas-card)] p-3">
        <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">Avanzado</summary>
        <p className="mt-2 text-xs font-semibold text-[color:var(--compas-muted)]">Technical timing, relay, nonce, route, RPC, sequencer, HMAC, broadcast, and raw tx details stay hidden here.</p>
      </details>
    </section>
  );
}

function RelayHealthBadge() {
  const { status, updatedAt } = useRelayHealth();
  const positive = status === "active";
  return <div className={`w-fit rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${positive ? "border-[color:var(--compas-accent)] bg-[color:var(--compas-accent)] text-[color:var(--compas-accent-ink)]" : "border-[color:var(--compas-line)] bg-[color:var(--compas-card)] text-[color:var(--compas-muted)]"}`} title={updatedAt ? `Última comprobación: ${updatedAt}` : undefined}>{relayHealthLabel(status)}</div>;
}

function useRelayHealth(): { status: RelayHealthBadgeStatus; updatedAt: string | null } {
  const [status, setStatus] = useState<RelayHealthBadgeStatus>("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    const relayUrl = GUIDED_RELAY_URL;
    let cancelled = false;
    let timer: number | null = null;

    async function checkHealth() {
      if (!relayUrl) {
        setStatus("unavailable");
        setUpdatedAt(new Date().toLocaleTimeString());
        return;
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetch(`${relayUrl}/health`, { cache: "no-store", signal: controller.signal });
        const payload = response.ok ? await response.json().catch(() => null) : null;
        if (!cancelled) setStatus(relayHealthStatusFromPayload(payload));
      } catch {
        if (!cancelled) setStatus("unavailable");
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) setUpdatedAt(new Date().toLocaleTimeString());
      }
    }

    void checkHealth();
    timer = window.setInterval(() => void checkHealth(), 45_000);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, []);

  return { status, updatedAt };
}

function NumberInput({ label, value, onChange, min }: { label: string; value: number; onChange: (value: number) => void; min: number }) {
  return <label className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">{label}<input type="number" min={min} value={value} onChange={(event) => onChange(Number(event.target.value))} className={`${FIELD} mt-2 normal-case tracking-normal`} /></label>;
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">{label}<input inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} className={`${FIELD} mt-2 normal-case tracking-normal`} /></label>;
}

function authorityCheckedFundingProvider(provider: Eip1193Provider, isCurrent: () => boolean): Eip1193Provider {
  return {
    async request(args) {
      if (!isCurrent()) throw new Error("Vault authority changed before funding. Review funding again; no transaction was sent.");
      const result = await provider.request(args);
      // A wallet may return a transaction hash after the Vault changes while its prompt is
      // open. Preserve that hash for reconciliation; all read-only awaits still fail stale.
      if (args.method !== "eth_sendTransaction" && !isCurrent()) {
        throw new Error("Vault authority changed during funding preflight. Review funding again; no transaction was sent.");
      }
      return result;
    },
  };
}

function getBrowserProvider(): Eip1193Provider {
  const ethereum = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (!ethereum) throw new Error("No connected browser wallet was found. Open this page in a wallet browser or install MetaMask/Rabby.");
  return ethereum;
}
