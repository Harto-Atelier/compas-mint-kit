"use client";

import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import BrowserBroadcastPanel from "@/app/components/BrowserBroadcastPanel";
import { CHAINS } from "@/lib/chains";
import { usePlannerStore } from "@/app/components/PlannerStoreProvider";
import type {
  FinalProductControls,
  MintDiscoveryError,
  MintDiscoveryResponse,
  MintStage,
  ScheduleError,
  ScheduleResponse,
  StageKind,
} from "@/lib/mint-types";
import { createWalletAliases, buildLocalCliCommand, buildRunConfigFilename, containsBrowserExecutionSecret, type RunConfigExportError, type RunConfigExportResponse, type RunConfigStageInput } from "@/lib/run-config";

const DEFAULT_QUERY = "base/collection/compas";
const MAX_RECOMMENDED_WALLETS = 20;

const STAGE_ACCENTS: Record<StageKind, string> = {
  team: "from-amber-50 to-orange-50 text-amber-950 border-amber-200/80",
  gtd: "from-sky-50 to-cyan-50 text-sky-950 border-sky-200/80",
  fcfs: "from-fuchsia-50 to-violet-50 text-fuchsia-950 border-fuchsia-200/80",
  public: "from-emerald-50 to-lime-50 text-emerald-950 border-emerald-200/80",
};

const SOURCE_LABELS: Record<MintStage["source"], string> = {
  "onchain-seadrop": "SeaDrop public",
  "opensea-signed-preview": "OpenSea signed",
  "mock-preview": "Preview fixture",
};

const COLLECTION_SOURCE_LABELS: Record<MintDiscoveryResponse["collection"]["source"], string> = {
  opensea: "OpenSea metadata",
  address: "Contract address",
  fallback: "Manual fallback",
};

const LOCAL_COMMAND_PLACEHOLDER = "downloaded-run-config.json";
const FINAL_PRODUCT_CHAIN_OPTIONS: { key: FinalProductControls["targetChainKey"]; label: string; detail: string }[] = [
  { key: "ethereum", label: "ETH Mainnet", detail: "Chain ID 1" },
  { key: "robinhood", label: "Robinhood Chain", detail: "Chain ID 4663" },
];
const RPC_STATUS_OPTIONS: { key: FinalProductControls["rpcStatus"]; label: string }[] = [
  { key: "unchecked", label: "Needs local CLI RPC check" },
  { key: "ready", label: "Operator confirmed RPC ready" },
  { key: "blocked", label: "RPC blocked / do not execute" },
];

const FIELD_CLASS =
  "h-12 rounded-2xl border border-violet-100 bg-white/90 px-4 text-slate-950 outline-none shadow-sm transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100";

type ReadinessState = "ready" | "review" | "blocked";

type ReadinessItem = {
  label: string;
  detail: string;
  state: ReadinessState;
};

type StageTiming = {
  status: MintStage["status"];
  statusLabel: string;
  metricLabel: string;
  primary: string;
  secondary: string;
  accent: string;
};

export default function MintConsole({ embedded = false }: { embedded?: boolean }) {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [chain, setChain] = useState("base");
  const [discovery, setDiscovery] = useState<MintDiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const {
    wallets,
    stageQuantities: quantities,
    setStageQuantity,
    walletCount,
    walletCapacity,
    setWalletCount,
    scheduleReceipt: schedule,
    setScheduleReceipt,
    clearScheduleReceipt,
  } = usePlannerStore();
  const [maxFeeGwei, setMaxFeeGwei] = useState(0.08);
  const [gasLimit, setGasLimit] = useState(250000);
  const [drainAddress, setDrainAddress] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState<"copy" | "download" | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [lastExportFilename, setLastExportFilename] = useState<string | null>(null);
  const [targetChainKey, setTargetChainKey] = useState<FinalProductControls["targetChainKey"]>("ethereum");
  const [rpcStatus, setRpcStatus] = useState<FinalProductControls["rpcStatus"]>("unchecked");
  const [maxSpendEth, setMaxSpendEth] = useState(0.25);
  const [concurrency, setConcurrency] = useState(2);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const activeStages = useMemo(() => discovery?.stages ?? [], [discovery]);
  const selectedStages = useMemo(() => activeStages.filter((stage) => (quantities[stage.id] ?? 0) > 0), [activeStages, quantities]);
  const selectedStageCount = selectedStages.length;
  const selectedTransactionCount = selectedStageCount * walletCount;
  const gasInputReady = Number.isFinite(maxFeeGwei) && maxFeeGwei > 0 && Number.isFinite(gasLimit) && gasLimit >= 21_000;
  const walletWarning = walletCount > MAX_RECOMMENDED_WALLETS;
  const walletsMissing = walletCount === 0;
  const totals = useMemo(() => calculateTotals(activeStages, quantities, walletCount, maxFeeGwei, gasLimit), [
    activeStages,
    quantities,
    walletCount,
    maxFeeGwei,
    gasLimit,
  ]);
  const maxSpendReady = Number.isFinite(maxSpendEth) && maxSpendEth >= totals.grandTotalValue;
  const concurrencyReady = Number.isFinite(concurrency) && concurrency >= 1 && concurrency <= walletCount;
  const finalControlsBlocked = !maxSpendReady || !concurrencyReady || rpcStatus === "blocked";
  const scheduleBlocked = selectedStageCount === 0 || walletsMissing || walletWarning || !gasInputReady || finalControlsBlocked;
  const readinessItems = useMemo(
    () => buildReadinessItems(activeStages, selectedStages, walletCount, maxFeeGwei, gasLimit, walletWarning, gasInputReady, {
      targetChainKey,
      rpcStatus,
      maxSpendEth,
      concurrency,
      maxSpendReady,
      concurrencyReady,
      grandTotalEth: totals.grandTotalEth,
    }),
    [activeStages, selectedStages, walletCount, maxFeeGwei, gasLimit, walletWarning, gasInputReady, targetChainKey, rpcStatus, maxSpendEth, concurrency, maxSpendReady, concurrencyReady, totals.grandTotalEth],
  );
  const plannedFilename = useMemo(
    () => (discovery ? buildRunConfigFilename(discovery.collection.slug || discovery.collection.name, targetChainKey) : LOCAL_COMMAND_PLACEHOLDER),
    [discovery, targetChainKey],
  );
  const localCommand = useMemo(
    () => buildLocalCliCommand(lastExportFilename === plannedFilename ? lastExportFilename : plannedFilename),
    [lastExportFilename, plannedFilename],
  );
  const finalProductControls = useMemo(
    () => ({ targetChainKey, rpcStatus, maxSpendEth, concurrency, executionMode: "planner-only" as const }),
    [targetChainKey, rpcStatus, maxSpendEth, concurrency],
  );

  async function handleDiscover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (containsBrowserExecutionSecret(query.trim())) {
      setError("Do not paste private keys into the mint discovery form. Enter a collection slug, OpenSea URL, or public contract address only.");
      setQuery("");
      setDiscovery(null);
      setExportStatus(null);
      setLastExportFilename(null);
      clearScheduleReceipt();
      return;
    }

    setLoading(true);
    setError(null);
    setExportStatus(null);
    setLastExportFilename(null);
    clearScheduleReceipt();

    try {
      const params = new URLSearchParams({ q: query, chain });
      const response = await fetch(`/api/mints/discover?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as MintDiscoveryResponse | MintDiscoveryError;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Discovery failed." : body.error);
      setDiscovery(body);
      setStageQuantity("public", body.stages.some((stage) => stage.id === "public") ? Math.max(quantities.public, 1) : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDiscovery(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleSchedule() {
    if (!discovery) return;
    setScheduleLoading(true);
    setError(null);
    clearScheduleReceipt();

    try {
      const response = await fetch("/api/mints/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collection: discovery.collection,
          stages: discovery.stages.map(toScheduleStageInput),
          quantities: discovery.stages.map((stage) => ({ stageId: stage.id, quantity: quantities[stage.id] ?? 0 })),
          walletCount,
          maxFeeGwei,
          gasLimit,
          drainAddress,
          finalProduct: finalProductControls,
        }),
      });
      const body = (await response.json()) as ScheduleResponse | ScheduleError;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Schedule failed." : body.error);
      setScheduleReceipt(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScheduleLoading(false);
    }
  }

  async function handleExport(mode: "copy" | "download") {
    if (!discovery) return;
    setExportLoading(mode);
    setExportStatus(null);
    setError(null);

    try {
      const response = await fetch("/api/mints/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collection: discovery.collection,
          stages: discovery.stages.map(toRunConfigStageInput),
          quantities: discovery.stages.map((stage) => ({ stageId: stage.id, quantity: quantities[stage.id] ?? 0 })),
          walletCount,
          walletAliases: createPlannerWalletAliases(wallets, walletCount),
          maxFeeGwei,
          gasLimit,
          drainAddress,
          finalProduct: finalProductControls,
        }),
      });
      const body = (await response.json()) as RunConfigExportResponse | RunConfigExportError;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "RunConfig export failed." : body.error);
      setLastExportFilename(body.filename);

      const json = `${JSON.stringify(body.config, null, 2)}\n`;
      if (mode === "copy") {
        await navigator.clipboard.writeText(json);
        setExportStatus(`Copied ${body.filename} to clipboard.`);
      } else {
        downloadJson(body.filename, json);
        setExportStatus(`Downloaded ${body.filename}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportLoading(null);
    }
  }

  async function handleCopyLocalCommand() {
    await navigator.clipboard.writeText(localCommand);
    setExportStatus("Copied local dry-run command.");
  }

  return (
    <div
      className={`${embedded ? "rounded-[2rem] border border-violet-100/90 bg-white/82 shadow-[0_24px_90px_rgba(77,63,132,0.12)]" : "min-h-screen bg-[radial-gradient(circle_at_top_left,#ede9fe_0,#f8fafc_36%,#ffffff_72%)]"} overflow-hidden text-slate-950`}
    >
      <main className={`mx-auto flex w-full max-w-7xl flex-col gap-6 ${embedded ? "px-4 py-5 sm:px-5" : "px-4 py-6 sm:px-6 lg:px-8"}`}>
        <Hero />

        <form onSubmit={handleDiscover} className="rounded-[2rem] border border-violet-100 bg-white/90 p-4 shadow-sm backdrop-blur md:p-5">
          <div className="flex flex-col gap-3 lg:flex-row">
            <label className="flex flex-1 flex-col gap-2 text-xs font-black uppercase tracking-[0.22em] text-slate-500">
              Collection
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="OpenSea slug, URL, item URL, or 0x contract"
                className={`${FIELD_CLASS} text-base normal-case tracking-normal`}
              />
            </label>
            <label className="flex flex-col gap-2 text-xs font-black uppercase tracking-[0.22em] text-slate-500 lg:w-60">
              Chain
              <select
                value={chain}
                onChange={(event) => setChain(event.target.value)}
                className={`${FIELD_CLASS} text-base normal-case tracking-normal`}
              >
                {CHAINS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={loading}
              className="h-12 rounded-2xl bg-violet-600 px-8 font-black text-white shadow-[0_16px_36px_rgba(124,58,237,0.24)] transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60 lg:self-end"
            >
              {loading ? "Discovering…" : "Discover mint"}
            </button>
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-500">
            Reads OpenSea metadata and local SeaDrop public config when available. Signed stages stay preview-only.
          </p>
        </form>

        {error ? <div className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}

        {discovery ? (
          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <section className="flex flex-col gap-6">
              <CollectionPanel discovery={discovery} />
              <ScheduleControls
                drainAddress={drainAddress}
                exportLoading={exportLoading}
                exportStatus={exportStatus}
                gasLimit={gasLimit}
                localCommand={localCommand}
                maxFeeGwei={maxFeeGwei}
                finalProductControls={finalProductControls}
                maxSpendReady={maxSpendReady}
                concurrencyReady={concurrencyReady}
                readinessItems={readinessItems}
                scheduleBlocked={scheduleBlocked}
                selectedStageCount={selectedStageCount}
                selectedTransactionCount={selectedTransactionCount}
                totals={totals}
                walletCapacity={walletCapacity}
                walletCount={walletCount}
                walletWarning={walletWarning}
                onDrainAddress={setDrainAddress}
                onExportCopy={() => handleExport("copy")}
                onExportDownload={() => handleExport("download")}
                onGasLimit={setGasLimit}
                onLocalCommandCopy={handleCopyLocalCommand}
                onMaxFee={setMaxFeeGwei}
                onTargetChain={setTargetChainKey}
                onRpcStatus={setRpcStatus}
                onMaxSpend={setMaxSpendEth}
                onConcurrency={setConcurrency}
                onSchedule={handleSchedule}
                onWalletCount={setWalletCount}
                scheduleLoading={scheduleLoading}
              />
              {schedule ? <ScheduleReceipt schedule={schedule} /> : null}
              <BrowserBroadcastPanel collection={discovery.collection} stages={discovery.stages} quantities={quantities} walletCount={walletCount} />
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              {discovery.stages.map((stage) => (
                <StageCard
                  key={stage.id}
                  stage={stage}
                  now={now}
                  quantity={quantities[stage.id] ?? 0}
                  onQuantity={(next) => setStageQuantity(stage.id, next)}
                />
              ))}
            </section>
          </div>
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}

function Hero() {
  return (
    <header className="flex flex-col gap-4 pt-2 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.35em] text-violet-600">Compas Mint Kit</p>
        <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
          Discover stages. Price wallets. Schedule the mint wave.
        </h1>
      </div>
      <div className="max-w-md rounded-3xl border border-violet-100 bg-violet-50/80 p-4 text-sm font-semibold leading-6 text-slate-600">
        <span className="font-black text-violet-700">Safety mode:</span> planning stays no-secret; browser signing only unlocks after vault passphrase, dry-run simulation, and an explicit broadcast modal.
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-black uppercase tracking-[0.14em] text-violet-700">
          <span className="rounded-2xl border border-violet-100 bg-white/80 px-3 py-2">Vault gated</span>
          <span className="rounded-2xl border border-violet-100 bg-white/80 px-3 py-2">Sim first</span>
          <span className="rounded-2xl border border-violet-100 bg-white/80 px-3 py-2">Modal send</span>
        </div>
      </div>
    </header>
  );
}

function CollectionPanel({ discovery }: { discovery: MintDiscoveryResponse }) {
  const { collection } = discovery;
  return (
    <section className="overflow-hidden rounded-[2rem] border border-violet-100 bg-white/90 shadow-sm">
      <div className="flex flex-col gap-5 p-5 sm:flex-row">
        <div className="relative h-32 w-full shrink-0 overflow-hidden rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-100 via-white to-fuchsia-100 sm:w-32">
          {collection.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={collection.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl font-black text-violet-300">C</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <Badge>{collection.chain.name}</Badge>
            <Badge>{COLLECTION_SOURCE_LABELS[collection.source]}</Badge>
          </div>
          <h2 className="mt-3 truncate text-3xl font-black text-slate-950">{collection.name}</h2>
          <p className="mt-2 break-all font-mono text-sm font-semibold text-slate-500">{collection.address}</p>
          {collection.description ? <p className="mt-3 line-clamp-2 text-sm font-semibold text-slate-500">{collection.description}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-black">
            <a href={collection.openseaUrl} target="_blank" rel="noreferrer" className="rounded-full bg-slate-950 px-4 py-2 text-white hover:bg-violet-700">
              Open in OpenSea
            </a>
            <a href={collection.explorerUrl} target="_blank" rel="noreferrer" className="rounded-full border border-violet-100 bg-white px-4 py-2 text-violet-700 hover:border-violet-200">
              Explorer
            </a>
          </div>
        </div>
      </div>
      {discovery.warnings.length > 0 ? (
        <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-800">
          <p className="font-black uppercase tracking-[0.16em] text-amber-700">Review warnings</p>
          <ul className="mt-2 space-y-1">
            {discovery.warnings.map((warning) => (
              <li key={warning}>⚠ {warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function StageCard({
  stage,
  now,
  quantity,
  onQuantity,
}: {
  stage: MintStage;
  now: number;
  quantity: number;
  onQuantity: (value: number) => void;
}) {
  const max = stage.maxPerWallet ?? 25;
  const quantityWarning = stage.maxPerWallet !== null && quantity > stage.maxPerWallet;
  const timing = getStageTiming(stage, now);

  return (
    <article className={`rounded-[2rem] border bg-gradient-to-br ${STAGE_ACCENTS[stage.id]} p-5 shadow-sm`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] opacity-60">{SOURCE_LABELS[stage.source]}</p>
          <h3 className="mt-2 text-2xl font-black text-slate-950">{stage.label}</h3>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${timing.accent}`}>
          {timing.statusLabel}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Metric label={timing.metricLabel} value={<CountdownValue timing={timing} />} />
        <Metric label="Price" value={`${stage.priceEth} ETH`} />
        <Metric label="Max" value={stage.maxPerWallet ? `${stage.maxPerWallet}/wallet` : "Open"} />
        <Metric label="Eligibility" value={<EligibilityPill value={stage.eligible} />} />
      </div>

      <p className="mt-4 min-h-12 text-sm font-semibold leading-6 text-slate-600">{stage.summary}</p>
      <StageLifecycle stage={stage} timing={timing} />
      {stage.feeRecipient ? <p className="mt-3 truncate font-mono text-xs font-semibold text-slate-500">Fee: {stage.feeRecipient}</p> : null}
      {stage.calldataPreview ? <p className="mt-1 font-mono text-xs font-semibold text-slate-500">Calldata preview: {stage.calldataPreview}…</p> : null}

      <label className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-white/70 bg-white/70 p-3 shadow-sm">
        <span className="text-sm font-black text-slate-800">Quantity / wallet</span>
        <input
          type="number"
          min={0}
          max={max}
          value={quantity}
          onChange={(event) => onQuantity(Number(event.target.value))}
          className="w-24 rounded-xl border border-violet-100 bg-white px-3 py-2 text-right text-lg font-black text-slate-950 outline-none focus:border-violet-300"
        />
      </label>
      {quantityWarning ? <p className="mt-2 text-xs font-bold text-amber-700">Exceeds max per wallet; preview cannot be treated as CLI-ready.</p> : null}
      {stage.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs font-semibold text-slate-500">
          {stage.warnings.map((warning) => (
            <li key={warning}>⚠ {warning}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function StageLifecycle({ stage, timing }: { stage: MintStage; timing: StageTiming }) {
  const steps = [
    {
      label: "Queued",
      detail: stage.startTime ? `Opens ${formatCompactDate(stage.startTime)}` : "Start unknown",
      state: timing.status === "upcoming" || timing.status === "unknown" ? "active" : "done",
    },
    {
      label: "Live",
      detail: timing.status === "live" ? timing.primary : timing.status === "ended" ? "Window passed" : "Waiting for open",
      state: timing.status === "live" ? "active" : timing.status === "ended" ? "done" : "pending",
    },
    {
      label: "Close",
      detail: stage.endTime ? `Ends ${formatCompactDate(stage.endTime)}` : "Manual close",
      state: timing.status === "ended" ? "active" : "pending",
    },
  ] as const;

  return (
    <div className="mt-4 rounded-2xl border border-white/75 bg-white/60 p-3">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Stage lifecycle</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {steps.map((step) => (
          <div
            key={step.label}
            className={`rounded-xl border px-3 py-2 ${
              step.state === "active"
                ? "border-violet-200 bg-violet-50 text-violet-800"
                : step.state === "done"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white/70 text-slate-500"
            }`}
          >
            <p className="text-xs font-black uppercase tracking-[0.16em]">{step.label}</p>
            <p className="mt-1 text-xs font-semibold leading-4">{step.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScheduleControls({
  drainAddress,
  exportLoading,
  exportStatus,
  gasLimit,
  localCommand,
  maxFeeGwei,
  finalProductControls,
  maxSpendReady,
  concurrencyReady,
  readinessItems,
  scheduleBlocked,
  selectedStageCount,
  selectedTransactionCount,
  totals,
  walletCapacity,
  walletCount,
  walletWarning,
  onDrainAddress,
  onExportCopy,
  onExportDownload,
  onGasLimit,
  onLocalCommandCopy,
  onMaxFee,
  onTargetChain,
  onRpcStatus,
  onMaxSpend,
  onConcurrency,
  onSchedule,
  onWalletCount,
  scheduleLoading,
}: {
  drainAddress: string;
  exportLoading: "copy" | "download" | null;
  exportStatus: string | null;
  gasLimit: number;
  localCommand: string;
  maxFeeGwei: number;
  finalProductControls: FinalProductControls;
  maxSpendReady: boolean;
  concurrencyReady: boolean;
  readinessItems: ReadinessItem[];
  scheduleBlocked: boolean;
  selectedStageCount: number;
  selectedTransactionCount: number;
  totals: ReturnType<typeof calculateTotals>;
  walletCapacity: number;
  walletCount: number;
  walletWarning: boolean;
  onDrainAddress: (value: string) => void;
  onExportCopy: () => void;
  onExportDownload: () => void;
  onGasLimit: (value: number) => void;
  onLocalCommandCopy: () => void;
  onMaxFee: (value: number) => void;
  onTargetChain: (value: FinalProductControls["targetChainKey"]) => void;
  onRpcStatus: (value: FinalProductControls["rpcStatus"]) => void;
  onMaxSpend: (value: number) => void;
  onConcurrency: (value: number) => void;
  onSchedule: () => void;
  onWalletCount: (value: number) => void;
  scheduleLoading: boolean;
}) {
  const gasPerTxEth = gasLimit * maxFeeGwei * 1e-9;
  const scheduleLabel = scheduleLoading
    ? "Saving read-only preview…"
    : scheduleBlocked
      ? walletCapacity === 0
        ? "Stage wallets in the Wallets tab first"
        : walletWarning
          ? `Reduce to ${MAX_RECOMMENDED_WALLETS} wallets or fewer`
          : selectedStageCount === 0
            ? "Select a stage quantity"
            : !maxSpendReady || !concurrencyReady || finalProductControls.rpcStatus === "blocked"
              ? "Fix final product controls"
              : "Set a positive gas ceiling"
      : "Save read-only schedule";

  return (
    <section className="rounded-[2rem] border border-violet-100 bg-white/90 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-violet-600">Schedule</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">Wallet wave</h2>
        </div>
        <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-right">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-500">Wallets used</p>
          <p className="text-2xl font-black text-slate-950">{walletCount}</p>
          <p className="text-xs font-bold text-violet-500">of {walletCapacity} staged</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <NumberField label="Wallet count" value={walletCount} min={1} max={MAX_RECOMMENDED_WALLETS} onChange={onWalletCount} />
        <NumberField label="Max fee (gwei)" value={maxFeeGwei} min={0} max={10_000} step={0.01} onChange={onMaxFee} />
        <NumberField label="Gas limit" value={gasLimit} min={21_000} max={2_000_000} step={1000} onChange={onGasLimit} />
      </div>

      {walletWarning ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          Max wallets warning: more than {MAX_RECOMMENDED_WALLETS} wallets should be split into smaller CLI batches for nonce and RPC reliability.
        </div>
      ) : null}

      <label className="mt-4 flex flex-col gap-2 text-xs font-black uppercase tracking-[0.22em] text-slate-500">
        Sweep destination (preview label only)
        <input
          value={drainAddress}
          onChange={(event) => onDrainAddress(event.target.value)}
          placeholder="0x… optional label; no sweep is executed"
          className={`${FIELD_CLASS} font-mono text-sm normal-case tracking-normal`}
        />
      </label>

      <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">Final product controls</p>
            <h3 className="mt-1 text-lg font-black text-slate-950">Mainnet readiness, no keys held</h3>
            <p className="mt-1 text-sm font-semibold text-slate-600">Web plans the run; the local CLI checks RPC and executes only on the operator machine.</p>
          </div>
          <Badge>Web plans · CLI local</Badge>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Target chain
            <select
              value={finalProductControls.targetChainKey}
              onChange={(event) => onTargetChain(event.target.value as FinalProductControls["targetChainKey"])}
              className={`${FIELD_CLASS} text-base normal-case tracking-normal`}
            >
              {FINAL_PRODUCT_CHAIN_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label} · {option.detail}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            RPC status
            <select
              value={finalProductControls.rpcStatus}
              onChange={(event) => onRpcStatus(event.target.value as FinalProductControls["rpcStatus"])}
              className={`${FIELD_CLASS} text-base normal-case tracking-normal`}
            >
              {RPC_STATUS_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>
          <NumberField label="Max spend cap (ETH)" value={finalProductControls.maxSpendEth} min={0.000001} max={10_000} step={0.001} onChange={onMaxSpend} />
          <NumberField label="Concurrency" value={finalProductControls.concurrency} min={1} max={walletCount} onChange={onConcurrency} />
        </div>
        <div className="mt-3 grid gap-2 text-sm font-semibold sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-600">
            Wallet alias count: <span className="font-black text-slate-950">{walletCount}</span> aliases, zero keys.
          </div>
          <div className={`rounded-2xl border p-3 ${maxSpendReady ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
            Spend cap: {maxSpendReady ? "covers" : "below"} estimated {totals.grandTotalEth} ETH.
          </div>
          <div className={`rounded-2xl border p-3 ${concurrencyReady ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
            Concurrency: {concurrencyReady ? `${finalProductControls.concurrency}/${walletCount}` : "must fit wallet aliases"}.
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Metric label="Gas / tx" value={`${formatNumber(gasPerTxEth)} ETH`} />
        <Metric label="Total gas" value={`${totals.gasCeilingEth} ETH`} />
        <Metric label="Mint total" value={`${totals.mintEth} ETH`} />
        <Metric label="Total" value={`${totals.grandTotalEth} ETH`} />
      </div>

      <div className="mt-4 rounded-3xl border border-violet-100 bg-violet-50/60 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-violet-600">RunConfig export</p>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              JSON bridge for local CLI execution: {selectedStageCount} stage(s), {selectedTransactionCount} wallet transaction(s), aliases only.
            </p>
          </div>
          <Badge>No keys · no tx</Badge>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {readinessItems.map((item) => (
            <div key={item.label} className="rounded-2xl border border-violet-100 bg-white/80 p-3 text-sm font-semibold text-slate-600">
              <span className={readinessTone(item.state)}>{item.state === "ready" ? "✓" : "!"}</span> {item.label}: {item.detail}
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onExportDownload}
            disabled={exportLoading !== null || selectedStageCount === 0}
            className="h-12 rounded-2xl border border-violet-200 bg-white px-4 font-black text-violet-700 shadow-sm transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exportLoading === "download" ? "Exporting…" : "Download RunConfig JSON"}
          </button>
          <button
            type="button"
            onClick={onExportCopy}
            disabled={exportLoading !== null || selectedStageCount === 0}
            className="h-12 rounded-2xl border border-violet-200 bg-white px-4 font-black text-violet-700 shadow-sm transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exportLoading === "copy" ? "Copying…" : "Copy JSON"}
          </button>
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-950 p-3 text-white">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">Local command</p>
              <code className="mt-1 block break-all font-mono text-xs font-semibold text-slate-100">{localCommand}</code>
            </div>
            <button
              type="button"
              onClick={onLocalCommandCopy}
              className="h-10 shrink-0 rounded-xl bg-white px-4 text-xs font-black text-slate-950 transition hover:bg-violet-100"
            >
              Copy command
            </button>
          </div>
          <p className="mt-2 text-xs font-semibold text-slate-300">Run from the repo root after moving the exported JSON there. Dry-run only.</p>
        </div>
        {exportStatus ? <p className="mt-3 text-sm font-bold text-emerald-700">{exportStatus}</p> : null}
      </div>

      <button
        type="button"
        onClick={onSchedule}
        disabled={scheduleLoading || scheduleBlocked}
        className="mt-5 h-14 w-full rounded-2xl bg-slate-950 px-6 font-black text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {scheduleLabel}
      </button>
    </section>
  );
}

function ScheduleReceipt({ schedule }: { schedule: ScheduleResponse }) {
  return (
    <section className="rounded-[2rem] border border-emerald-200 bg-emerald-50 p-5 text-sm font-semibold text-emerald-800 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-600">Preview generated</p>
          <h2 className="mt-1 font-mono text-lg font-black text-slate-950">{schedule.scheduleId}</h2>
        </div>
        <Badge>No broadcast</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric label="Fire at" value={schedule.fireAt ? new Date(schedule.fireAt).toLocaleString() : "Manual"} />
        <Metric label="Wallets" value={schedule.walletsUsed} />
        <Metric label="Grand total" value={`${schedule.totals.grandTotalEth} ETH`} />
      </div>
      <ul className="mt-4 space-y-2 text-emerald-800">
        {schedule.warnings.map((warning) => (
          <li key={warning}>⚠ {warning}</li>
        ))}
      </ul>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="grid gap-4 rounded-[2rem] border border-dashed border-violet-200 bg-white/65 p-8 text-slate-600 md:grid-cols-4">
      {[
        ["1", "Search", "Paste a slug, OpenSea link, item URL, or contract address."],
        ["2", "Review", "Collection card resolves address, chain, OpenSea and explorer links."],
        ["3", "Stage", "TEAM, GTD, FCFS and PUBLIC cards expose start, price, max and eligibility."],
        ["4", "Export", "Download or copy a no-secret RunConfig JSON for the local CLI."],
      ].map(([number, title, copy]) => (
        <div key={number} className="rounded-3xl border border-violet-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-black text-violet-600">{number}</p>
          <h3 className="mt-2 text-lg font-black text-slate-950">{title}</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{copy}</p>
        </div>
      ))}
    </section>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-violet-100 bg-violet-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-violet-700">{children}</span>;
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white/80 p-3 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <div className="mt-1 break-words text-sm font-black text-slate-950">{value}</div>
    </div>
  );
}

function NumberField({
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  max?: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <label className="flex flex-col gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`${FIELD_CLASS} text-base normal-case tracking-normal`}
      />
    </label>
  );
}

function buildReadinessItems(
  stages: MintStage[],
  selectedStages: MintStage[],
  walletCount: number,
  maxFeeGwei: number,
  gasLimit: number,
  walletWarning: boolean,
  gasInputReady: boolean,
  finalControls?: {
    targetChainKey: FinalProductControls["targetChainKey"];
    rpcStatus: FinalProductControls["rpcStatus"];
    maxSpendEth: number;
    concurrency: number;
    maxSpendReady: boolean;
    concurrencyReady: boolean;
    grandTotalEth: string;
  },
): ReadinessItem[] {
  const signedSelected = selectedStages.some((stage) => stage.source !== "onchain-seadrop");
  const items: ReadinessItem[] = [
    {
      label: "Stage selection",
      detail: selectedStages.length > 0 ? `${selectedStages.length}/${stages.length} selected` : "select at least one stage",
      state: selectedStages.length > 0 ? "ready" : "blocked",
    },
    {
      label: "Wallet aliases",
      detail:
        walletCount === 0
          ? "no wallets staged; import wallets first"
          : walletWarning
            ? `${walletCount} exceeds preview guardrail`
            : `${walletCount} alias(es) will be exported`,
      state: walletCount === 0 || walletWarning ? "blocked" : "ready",
    },
    {
      label: "Gas ceiling",
      detail: gasInputReady ? `${gasLimit.toLocaleString()} gas @ ${maxFeeGwei} gwei` : "set positive gas inputs",
      state: gasInputReady ? "ready" : "blocked",
    },
    {
      label: "Authorization",
      detail: signedSelected ? "signed stages need CLI-side wallet-specific authorization" : "public/onchain stages only",
      state: signedSelected ? "review" : "ready",
    },
  ];

  if (finalControls) {
    items.push(
      {
        label: "Target chain",
        detail: `${finalControls.targetChainKey} · RPC ${finalControls.rpcStatus}`,
        state: finalControls.rpcStatus === "blocked" ? "blocked" : finalControls.rpcStatus === "ready" ? "ready" : "review",
      },
      {
        label: "Spend cap",
        detail: `${finalControls.maxSpendEth} ETH cap vs ${finalControls.grandTotalEth} ETH estimate`,
        state: finalControls.maxSpendReady ? "ready" : "blocked",
      },
      {
        label: "Concurrency",
        detail: `${finalControls.concurrency}/${walletCount} wallet(s) per local batch`,
        state: finalControls.concurrencyReady ? "ready" : "blocked",
      },
    );
  }

  return items;
}

function getStageTiming(stage: MintStage, now: number): StageTiming {
  const start = stage.startTime ? new Date(stage.startTime).getTime() : null;
  const end = stage.endTime ? new Date(stage.endTime).getTime() : null;
  const started = start === null || start <= now;
  const ended = stage.status === "ended" || (end !== null && end <= now);
  const live = !ended && (stage.status === "live" || started);
  const target = live ? end : start;
  const primary = target ? formatDuration(target - now, live ? "until close" : "until open") : "Unknown";

  if (ended) {
    return {
      status: "ended",
      statusLabel: "Closed",
      metricLabel: "Closed",
      primary: "Closed",
      secondary: "Stage window has passed or OpenSea marks it ended.",
      accent: "border-zinc-300 bg-zinc-100 text-zinc-600",
    };
  }

  if (live) {
    return {
      status: "live",
      statusLabel: "Open now",
      metricLabel: "Closes",
      primary,
      secondary: "Stage is open according to this preview.",
      accent: "border-emerald-300 bg-emerald-100 text-emerald-700",
    };
  }

  if (stage.status === "upcoming" || start !== null) {
    return {
      status: "upcoming",
      statusLabel: "Queued",
      metricLabel: "Opens",
      primary,
      secondary: "Stage start is pending.",
      accent: "border-sky-300 bg-sky-100 text-sky-700",
    };
  }

  return {
    status: "unknown",
    statusLabel: "Check timing",
    metricLabel: "Timing",
    primary: "Unknown",
    secondary: "No reliable start or end time was found.",
    accent: "border-amber-300 bg-amber-100 text-amber-700",
  };
}

function CountdownValue({ timing }: { timing: StageTiming }) {
  return <span title={timing.secondary}>{timing.primary}</span>;
}

function EligibilityPill({ value }: { value: MintStage["eligible"] }) {
  const tone: Record<MintStage["eligible"], string> = {
    checked: "border-emerald-200 bg-emerald-50 text-emerald-700",
    unknown: "border-slate-200 bg-slate-50 text-slate-600",
    "watch-only": "border-violet-200 bg-violet-50 text-violet-700",
    ended: "border-zinc-200 bg-zinc-50 text-zinc-600",
    unavailable: "border-rose-200 bg-rose-50 text-rose-700",
  };

  return <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${tone[value]}`}>{eligibilityLabel(value)}</span>;
}

function toScheduleStageInput(stage: MintStage): Omit<MintStage, "calldataPreview"> {
  return {
    id: stage.id,
    label: stage.label,
    source: stage.source,
    status: stage.status,
    startTime: stage.startTime,
    endTime: stage.endTime,
    priceEth: stage.priceEth,
    maxPerWallet: stage.maxPerWallet,
    eligible: stage.eligible,
    summary: stage.summary,
    feeRecipient: stage.feeRecipient,
    warnings: stage.warnings,
  };
}

function toRunConfigStageInput(stage: MintStage): RunConfigStageInput {
  return {
    id: stage.id,
    label: stage.label,
    source: stage.source,
    status: stage.status,
    startTime: stage.startTime,
    endTime: stage.endTime,
    priceEth: stage.priceEth,
    maxPerWallet: stage.maxPerWallet,
    feeRecipient: stage.feeRecipient ?? null,
    warnings: stage.warnings,
  };
}

function createPlannerWalletAliases(wallets: { name: string; id: string }[], walletCount: number): string[] {
  const aliases = wallets.slice(0, walletCount).map((wallet, index) => sanitizeAlias(wallet.name || wallet.id || `wallet-${index + 1}`));
  return aliases.length === walletCount ? aliases : createWalletAliases(walletCount);
}

function sanitizeAlias(value: string): string {
  const alias = value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "") || "wallet";
  return containsBrowserExecutionSecret(value) || containsBrowserExecutionSecret(alias) ? "wallet" : alias;
}

function downloadJson(filename: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readinessTone(state: ReadinessState) {
  const tones: Record<ReadinessState, string> = {
    ready: "mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs font-black text-emerald-700",
    review: "mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-xs font-black text-amber-700",
    blocked: "mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-xs font-black text-red-700",
  };
  return tones[state];
}

function formatDuration(deltaMs: number, suffix: string) {
  if (deltaMs <= 0) return "Now";
  const minutes = Math.floor(deltaMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const value = days > 0 ? `${days}d ${hours % 24}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${Math.max(1, minutes)}m`;
  return `${value} ${suffix}`;
}

function formatCompactDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function eligibilityLabel(value: MintStage["eligible"]) {
  const labels: Record<MintStage["eligible"], string> = {
    checked: "Checked",
    unknown: "Unknown",
    "watch-only": "Watch",
    ended: "Ended",
    unavailable: "Unavailable",
  };
  return labels[value];
}

function calculateTotals(
  stages: MintStage[],
  quantities: Record<StageKind, number>,
  walletCount: number,
  maxFeeGwei: number,
  gasLimit: number,
) {
  const selectedStages = stages.filter((stage) => (quantities[stage.id] ?? 0) > 0);
  const mintEth = selectedStages.reduce((sum, stage) => sum + Number(stage.priceEth || 0) * (quantities[stage.id] ?? 0) * walletCount, 0);
  const gasCeilingEth = selectedStages.length * walletCount * gasLimit * maxFeeGwei * 1e-9;
  const grandTotalValue = mintEth + gasCeilingEth;
  return {
    mintEth: formatNumber(mintEth),
    gasCeilingEth: formatNumber(gasCeilingEth),
    grandTotalEth: formatNumber(grandTotalValue),
    grandTotalValue,
  };
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 4, useGrouping: false });
}
