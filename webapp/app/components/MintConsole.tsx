"use client";

import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { CHAINS } from "@/lib/chains";
import type {
  MintDiscoveryError,
  MintDiscoveryResponse,
  MintStage,
  ScheduleError,
  ScheduleResponse,
  StageKind,
} from "@/lib/mint-types";

const DEFAULT_QUERY = "base/collection/compas";
const MAX_RECOMMENDED_WALLETS = 20;

const STAGE_ACCENTS: Record<StageKind, string> = {
  team: "from-amber-500/20 to-orange-500/5 text-amber-100 border-amber-400/25",
  gtd: "from-cyan-500/20 to-sky-500/5 text-cyan-100 border-cyan-400/25",
  fcfs: "from-fuchsia-500/20 to-pink-500/5 text-fuchsia-100 border-fuchsia-400/25",
  public: "from-emerald-500/20 to-lime-500/5 text-emerald-100 border-emerald-400/25",
};

export default function MintConsole({ embedded = false }: { embedded?: boolean }) {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [chain, setChain] = useState("base");
  const [discovery, setDiscovery] = useState<MintDiscoveryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [quantities, setQuantities] = useState<Record<StageKind, number>>({
    team: 0,
    gtd: 0,
    fcfs: 0,
    public: 1,
  });
  const [walletCount, setWalletCount] = useState(3);
  const [maxFeeGwei, setMaxFeeGwei] = useState(0.08);
  const [gasLimit, setGasLimit] = useState(250000);
  const [drainAddress, setDrainAddress] = useState("");
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  const activeStages = useMemo(() => discovery?.stages ?? [], [discovery]);
  const totals = useMemo(() => calculateTotals(activeStages, quantities, walletCount, maxFeeGwei, gasLimit), [
    activeStages,
    quantities,
    walletCount,
    maxFeeGwei,
    gasLimit,
  ]);
  const selectedStageCount = activeStages.filter((stage) => (quantities[stage.id] ?? 0) > 0).length;
  const walletWarning = walletCount > MAX_RECOMMENDED_WALLETS;

  async function handleDiscover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSchedule(null);

    try {
      const params = new URLSearchParams({ q: query, chain });
      const response = await fetch(`/api/mints/discover?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as MintDiscoveryResponse | MintDiscoveryError;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Discovery failed." : body.error);
      setDiscovery(body);
      setQuantities((current) => ({
        ...current,
        public: body.stages.some((stage) => stage.id === "public") ? Math.max(current.public, 1) : 0,
      }));
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
    setSchedule(null);

    try {
      const response = await fetch("/api/mints/schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          collection: discovery.collection,
          stages: discovery.stages,
          quantities: discovery.stages.map((stage) => ({ stageId: stage.id, quantity: quantities[stage.id] ?? 0 })),
          walletCount,
          maxFeeGwei,
          gasLimit,
          drainAddress,
        }),
      });
      const body = (await response.json()) as ScheduleResponse | ScheduleError;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Schedule failed." : body.error);
      setSchedule(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScheduleLoading(false);
    }
  }

  return (
    <div className={`${embedded ? "rounded-[2rem] border border-white/10" : "min-h-screen"} overflow-hidden bg-[#070604] text-stone-100`}>
      <div className="absolute inset-0 -z-0 bg-[radial-gradient(circle_at_top_left,rgba(246,111,32,0.16),transparent_35%),radial-gradient(circle_at_top_right,rgba(55,198,148,0.14),transparent_30%)]" />
      <main className={`relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-8 ${embedded ? "px-4 py-5 sm:px-5" : "px-4 py-6 sm:px-6 lg:px-8"}`}>
        <Hero />

        <form onSubmit={handleDiscover} className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/30 backdrop-blur md:p-5">
          <div className="flex flex-col gap-3 lg:flex-row">
            <label className="flex flex-1 flex-col gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-stone-400">
              Collection
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="OpenSea slug, URL, item URL, or 0x contract"
                className="h-14 rounded-2xl border border-white/10 bg-black/40 px-4 text-base normal-case tracking-normal text-white outline-none ring-orange-400/0 transition focus:border-orange-300/60 focus:ring-4 focus:ring-orange-400/10"
              />
            </label>
            <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-stone-400 lg:w-60">
              Chain
              <select
                value={chain}
                onChange={(event) => setChain(event.target.value)}
                className="h-14 rounded-2xl border border-white/10 bg-black/40 px-4 text-base normal-case tracking-normal text-white outline-none ring-orange-400/0 transition focus:border-orange-300/60 focus:ring-4 focus:ring-orange-400/10"
              >
                {CHAINS.map((option) => (
                  <option key={option.key} value={option.key} className="bg-stone-950">
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={loading}
              className="h-14 rounded-2xl bg-orange-400 px-8 font-bold text-stone-950 transition hover:bg-orange-300 disabled:cursor-not-allowed disabled:opacity-60 lg:self-end"
            >
              {loading ? "Discovering…" : "Discover mint"}
            </button>
          </div>
          <p className="mt-3 text-sm text-stone-400">
            Reads OpenSea metadata and local SeaDrop public config when available. Signed stages stay preview-only.
          </p>
        </form>

        {error ? (
          <div className="rounded-3xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>
        ) : null}

        {discovery ? (
          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <section className="flex flex-col gap-6">
              <CollectionPanel discovery={discovery} />
              <ScheduleControls
                drainAddress={drainAddress}
                gasLimit={gasLimit}
                maxFeeGwei={maxFeeGwei}
                selectedStageCount={selectedStageCount}
                totals={totals}
                walletCount={walletCount}
                walletWarning={walletWarning}
                onDrainAddress={setDrainAddress}
                onGasLimit={setGasLimit}
                onMaxFee={setMaxFeeGwei}
                onSchedule={handleSchedule}
                onWalletCount={setWalletCount}
                scheduleLoading={scheduleLoading}
              />
              {schedule ? <ScheduleReceipt schedule={schedule} /> : null}
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              {discovery.stages.map((stage) => (
                <StageCard
                  key={stage.id}
                  stage={stage}
                  quantity={quantities[stage.id] ?? 0}
                  onQuantity={(next) => setQuantities((current) => ({ ...current, [stage.id]: next }))}
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
    <header className="flex flex-col gap-4 pt-4 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.45em] text-orange-300">Compas Mint Kit</p>
        <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight text-white sm:text-6xl">
          Discover stages. Price wallets. Schedule the mint wave.
        </h1>
      </div>
      <div className="max-w-md rounded-3xl border border-white/10 bg-black/30 p-4 text-sm text-stone-300">
        <span className="font-semibold text-orange-200">Safety mode:</span> this webapp never asks for private keys, never signs,
        and never broadcasts. It produces a reviewed schedule for the CLI path.
      </div>
    </header>
  );
}

function CollectionPanel({ discovery }: { discovery: MintDiscoveryResponse }) {
  const { collection } = discovery;
  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/25">
      <div className="flex flex-col gap-5 p-5 sm:flex-row">
        <div className="relative h-32 w-full shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-orange-500/35 via-stone-900 to-emerald-500/25 sm:w-32">
          {collection.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={collection.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl font-black text-white/50">C</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <Badge>{collection.chain.name}</Badge>
            <Badge>{collection.source}</Badge>
          </div>
          <h2 className="mt-3 truncate text-3xl font-black text-white">{collection.name}</h2>
          <p className="mt-2 break-all font-mono text-sm text-stone-400">{collection.address}</p>
          {collection.description ? <p className="mt-3 line-clamp-2 text-sm text-stone-400">{collection.description}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
            <a href={collection.openseaUrl} target="_blank" rel="noreferrer" className="rounded-full bg-white px-4 py-2 text-stone-950 hover:bg-orange-100">
              Open in OpenSea
            </a>
            <a href={collection.explorerUrl} target="_blank" rel="noreferrer" className="rounded-full border border-white/10 px-4 py-2 text-stone-200 hover:border-white/30">
              Explorer
            </a>
          </div>
        </div>
      </div>
      {discovery.warnings.length > 0 ? (
        <div className="border-t border-white/10 bg-orange-500/10 px-5 py-3 text-sm text-orange-100">
          {discovery.warnings[0]}
        </div>
      ) : null}
    </section>
  );
}

function StageCard({
  stage,
  quantity,
  onQuantity,
}: {
  stage: MintStage;
  quantity: number;
  onQuantity: (value: number) => void;
}) {
  const max = stage.maxPerWallet ?? 25;
  const quantityWarning = stage.maxPerWallet !== null && quantity > stage.maxPerWallet;

  return (
    <article className={`rounded-[2rem] border bg-gradient-to-br ${STAGE_ACCENTS[stage.id]} p-5 shadow-xl shadow-black/20`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.32em] opacity-75">{stage.source.replaceAll("-", " ")}</p>
          <h3 className="mt-2 text-2xl font-black text-white">{stage.label}</h3>
        </div>
        <span className="rounded-full border border-white/15 bg-black/25 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white/80">
          {stage.status}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Metric label="Starts in" value={<Countdown iso={stage.startTime} />} />
        <Metric label="Price" value={`${stage.priceEth} ETH`} />
        <Metric label="Max" value={stage.maxPerWallet ? `${stage.maxPerWallet}/wallet` : "Open"} />
        <Metric label="Eligible" value={eligibilityLabel(stage.eligible)} />
      </div>

      <p className="mt-4 min-h-12 text-sm leading-6 text-stone-200/80">{stage.summary}</p>

      {stage.feeRecipient ? <p className="mt-3 truncate font-mono text-xs text-stone-300">Fee: {stage.feeRecipient}</p> : null}
      {stage.calldataPreview ? <p className="mt-1 font-mono text-xs text-stone-300">Calldata: {stage.calldataPreview}…</p> : null}

      <label className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/25 p-3">
        <span className="text-sm font-bold text-white">Quantity / wallet</span>
        <input
          type="number"
          min={0}
          max={max}
          value={quantity}
          onChange={(event) => onQuantity(Number(event.target.value))}
          className="w-24 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-right text-lg font-black text-white outline-none focus:border-orange-300/60"
        />
      </label>
      {quantityWarning ? <p className="mt-2 text-xs font-semibold text-orange-200">Exceeds max per wallet; schedule will warn.</p> : null}
      {stage.warnings[0] ? <p className="mt-3 text-xs text-stone-300/80">⚠ {stage.warnings[0]}</p> : null}
    </article>
  );
}

function ScheduleControls({
  drainAddress,
  gasLimit,
  maxFeeGwei,
  selectedStageCount,
  totals,
  walletCount,
  walletWarning,
  onDrainAddress,
  onGasLimit,
  onMaxFee,
  onSchedule,
  onWalletCount,
  scheduleLoading,
}: {
  drainAddress: string;
  gasLimit: number;
  maxFeeGwei: number;
  selectedStageCount: number;
  totals: ReturnType<typeof calculateTotals>;
  walletCount: number;
  walletWarning: boolean;
  onDrainAddress: (value: string) => void;
  onGasLimit: (value: number) => void;
  onMaxFee: (value: number) => void;
  onSchedule: () => void;
  onWalletCount: (value: number) => void;
  scheduleLoading: boolean;
}) {
  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/25">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.32em] text-stone-400">Schedule</p>
          <h2 className="mt-1 text-2xl font-black text-white">Wallet wave</h2>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-right">
          <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Wallets used</p>
          <p className="text-2xl font-black text-white">{walletCount}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <NumberField label="Wallet count" value={walletCount} min={1} max={100} onChange={onWalletCount} />
        <NumberField label="Max fee (gwei)" value={maxFeeGwei} min={0} step={0.01} onChange={onMaxFee} />
        <NumberField label="Gas limit" value={gasLimit} min={21000} step={1000} onChange={onGasLimit} />
      </div>

      {walletWarning ? (
        <div className="mt-4 rounded-2xl border border-orange-300/25 bg-orange-400/10 p-3 text-sm text-orange-100">
          Max wallets warning: more than {MAX_RECOMMENDED_WALLETS} wallets should be split into smaller CLI batches for nonce and RPC reliability.
        </div>
      ) : null}

      <label className="mt-4 flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-stone-400">
        Drain address
        <input
          value={drainAddress}
          onChange={(event) => onDrainAddress(event.target.value)}
          placeholder="0x… optional post-mint sweep destination"
          className="h-12 rounded-2xl border border-white/10 bg-black/30 px-4 font-mono text-sm normal-case tracking-normal text-white outline-none focus:border-orange-300/60"
        />
      </label>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Metric label="Total gas" value={`${totals.gasCeilingEth} ETH`} />
        <Metric label="Mint total" value={`${totals.mintEth} ETH`} />
        <Metric label="Total" value={`${totals.grandTotalEth} ETH`} />
      </div>

      <button
        type="button"
        onClick={onSchedule}
        disabled={scheduleLoading || selectedStageCount === 0}
        className="mt-5 h-14 w-full rounded-2xl bg-emerald-300 px-6 font-black text-stone-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {scheduleLoading ? "Scheduling preview…" : "Schedule"}
      </button>
    </section>
  );
}

function ScheduleReceipt({ schedule }: { schedule: ScheduleResponse }) {
  return (
    <section className="rounded-[2rem] border border-emerald-300/20 bg-emerald-400/10 p-5 text-sm text-emerald-50">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.32em] text-emerald-200/80">Preview saved</p>
          <h2 className="mt-1 font-mono text-lg font-black text-white">{schedule.scheduleId}</h2>
        </div>
        <Badge>No broadcast</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Metric label="Fire at" value={schedule.fireAt ? new Date(schedule.fireAt).toLocaleString() : "Manual"} />
        <Metric label="Wallets" value={schedule.walletsUsed} />
        <Metric label="Grand total" value={`${schedule.totals.grandTotalEth} ETH`} />
      </div>
      <ul className="mt-4 space-y-2 text-stone-200">
        {schedule.warnings.map((warning) => (
          <li key={warning}>⚠ {warning}</li>
        ))}
      </ul>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="grid gap-4 rounded-[2rem] border border-dashed border-white/15 bg-white/[0.03] p-8 text-stone-300 md:grid-cols-4">
      {[
        ["1", "Search", "Paste a slug, OpenSea link, item URL, or contract address."],
        ["2", "Review", "Collection card resolves address, chain, OpenSea and explorer links."],
        ["3", "Stage", "TEAM, GTD, FCFS and PUBLIC cards expose start, price, max and eligibility."],
        ["4", "Schedule", "Quantity × wallet wave × gas creates a no-broadcast preview."],
      ].map(([number, title, copy]) => (
        <div key={number} className="rounded-3xl border border-white/10 bg-black/25 p-4">
          <p className="text-sm font-black text-orange-300">{number}</p>
          <h3 className="mt-2 text-lg font-black text-white">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-stone-400">{copy}</p>
        </div>
      ))}
    </section>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-stone-200">{children}</span>;
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-500">{label}</p>
      <div className="mt-1 break-words text-sm font-black text-white">{value}</div>
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
    <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-12 rounded-2xl border border-white/10 bg-black/30 px-3 text-base normal-case tracking-normal text-white outline-none focus:border-orange-300/60"
      />
    </label>
  );
}

function Countdown({ iso }: { iso: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const label = useMemo(() => {
    if (!iso) return "Unknown";
    const delta = new Date(iso).getTime() - now;
    if (delta <= 0) return "Now / live";
    const minutes = Math.floor(delta / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${Math.max(1, minutes)}m`;
  }, [iso, now]);
  return <>{label}</>;
}

function eligibilityLabel(value: MintStage["eligible"]) {
  const labels: Record<MintStage["eligible"], string> = {
    eligible: "Eligible",
    "needs-signature": "Needs sig",
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
  gasLimit: number
) {
  const selectedStages = stages.filter((stage) => (quantities[stage.id] ?? 0) > 0);
  const mintEth = selectedStages.reduce((sum, stage) => sum + Number(stage.priceEth || 0) * (quantities[stage.id] ?? 0) * walletCount, 0);
  const gasCeilingEth = selectedStages.length * walletCount * gasLimit * maxFeeGwei * 1e-9;
  return {
    mintEth: formatNumber(mintEth),
    gasCeilingEth: formatNumber(gasCeilingEth),
    grandTotalEth: formatNumber(mintEth + gasCeilingEth),
  };
}

function formatNumber(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 4, useGrouping: false });
}
