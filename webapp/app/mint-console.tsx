"use client";

import { useMemo, useState } from "react";
import {
  ACO_PLACEHOLDERS,
  ANALYTICS_METRICS,
  COLLECTION_ROWS,
  COLLECTION_TABS,
  DISPERSE_ASSET_TYPES,
  DISPERSE_CURRENCIES,
  DISPERSE_PREVIEW,
  PREVIEW_SAFETY,
  TRANSACTION_QUEUE,
  type CollectionTab,
  type DisperseAssetType,
  type DisperseCurrency,
  type MintRow,
  shortenWallet,
} from "../lib/mint-console-data";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function StatusPill({ status }: { status: MintRow["status"] }) {
  const tone = {
    "minted-preview": "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    scheduled: "border-sky-400/30 bg-sky-400/10 text-sky-200",
    queued: "border-amber-400/30 bg-amber-400/10 text-amber-100",
    "manual-review": "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-100",
    "alert-only": "border-zinc-400/30 bg-zinc-400/10 text-zinc-200",
  }[status];

  return (
    <span className={cx("rounded-full border px-2.5 py-1 text-xs font-medium", tone)}>
      {status.replaceAll("-", " ")}
    </span>
  );
}

function SafetyStrip() {
  return (
    <section className="rounded-[2rem] border border-emerald-300/20 bg-emerald-300/10 p-5 text-sm text-emerald-50 shadow-2xl shadow-emerald-950/20">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200/80">
            Preview safety lock
          </p>
          <h2 className="mt-1 text-xl font-semibold">No custody · no signing · no broadcast</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <span className="rounded-full border border-emerald-200/20 bg-black/20 px-3 py-2">
            Execution: {PREVIEW_SAFETY.execution}
          </span>
          <span className="rounded-full border border-emerald-200/20 bg-black/20 px-3 py-2">
            Broadcast: {String(PREVIEW_SAFETY.broadcast)}
          </span>
          <span className="rounded-full border border-emerald-200/20 bg-black/20 px-3 py-2">
            Custody: {String(PREVIEW_SAFETY.custody)}
          </span>
          <span className="rounded-full border border-emerald-200/20 bg-black/20 px-3 py-2">
            Source: {PREVIEW_SAFETY.source}
          </span>
        </div>
      </div>
      <p className="mt-3 max-w-4xl text-emerald-100/75">{PREVIEW_SAFETY.note}</p>
    </section>
  );
}

function Segment<T extends string>({
  label,
  values,
  active,
  onChange,
}: {
  label: string;
  values: readonly T[];
  active: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">{label}</p>
      <div className="grid grid-cols-2 rounded-full border border-zinc-800 bg-zinc-950/80 p-1">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className={cx(
              "rounded-full px-4 py-2 text-sm font-semibold transition",
              active === value ? "bg-white text-zinc-950" : "text-zinc-400 hover:text-white",
            )}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}

function WalletList({ title, wallets }: { title: string; wallets: typeof DISPERSE_PREVIEW.senders }) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-white">{title}</h3>
        <span className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">{wallets.length}</span>
      </div>
      <div className="space-y-2">
        {wallets.map((wallet) => (
          <div
            key={wallet.wallet}
            className="flex items-center justify-between rounded-2xl border border-zinc-800/80 bg-black/30 px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-zinc-100">{wallet.label}</p>
              <p className="font-mono text-xs text-zinc-500">{shortenWallet(wallet.wallet)}</p>
            </div>
            <span className="rounded-full border border-zinc-700 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-zinc-400">
              {wallet.role}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DispersePanel() {
  const [assetType, setAssetType] = useState<DisperseAssetType>(DISPERSE_PREVIEW.assetType);
  const [currency, setCurrency] = useState<DisperseCurrency>(DISPERSE_PREVIEW.currency);

  return (
    <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/80 p-5 shadow-2xl shadow-black/30 lg:p-6">
      <div className="flex flex-col gap-3 border-b border-zinc-800 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300/80">Disperse placeholder</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Flat wallet distribution builder</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Umi-style sender/recipient planner with NFT/ERC20 and ETH/USD controls. The Disperse action is disabled and
            emits no transaction payload.
          </p>
        </div>
        <span className="w-fit rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
          {DISPERSE_PREVIEW.status.replace("-", " ")}
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Segment label="Asset" values={DISPERSE_ASSET_TYPES} active={assetType} onChange={setAssetType} />
            <Segment label="Currency" values={DISPERSE_CURRENCIES} active={currency} onChange={setCurrency} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Mode</span>
              <input
                readOnly
                value={DISPERSE_PREVIEW.mode}
                className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3 text-white outline-none"
              />
            </label>
            <label className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Per wallet amount</span>
              <input
                readOnly
                value={`${DISPERSE_PREVIEW.amountPerWallet} ${assetType === "NFT" ? "NFT" : currency}`}
                className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3 text-white outline-none"
              />
            </label>
          </div>
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-2xl border border-zinc-700 bg-zinc-800 px-5 py-4 text-sm font-bold uppercase tracking-[0.24em] text-zinc-400"
          >
            Disperse disabled · no broadcast
          </button>
          <p className="text-xs leading-5 text-zinc-500">{DISPERSE_PREVIEW.note}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <WalletList title="Senders" wallets={DISPERSE_PREVIEW.senders} />
          <WalletList title="Recipients" wallets={DISPERSE_PREVIEW.recipients} />
        </div>
      </div>
    </section>
  );
}

function AcoPanel() {
  return (
    <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/80 p-5 shadow-2xl shadow-black/30 lg:p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-300/80">ACO placeholders</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Agent collection operator preview</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Watch-only scheduling cards for mint windows, holder review, and risk alerts. These rows are advisory fixtures,
            not autonomous execution.
          </p>
        </div>
        <span className="w-fit rounded-full border border-violet-300/20 bg-violet-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-violet-100">
          no signer connected
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {ACO_PLACEHOLDERS.map((item) => (
          <article key={item.label} className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-white">{item.label}</h3>
              <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2 py-1 text-[11px] text-violet-100">
                {item.state.replace("-", " ")}
              </span>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3 text-zinc-400">
                <dt>Cadence</dt>
                <dd className="text-right text-zinc-200">{item.cadence}</dd>
              </div>
              <div className="flex justify-between gap-3 text-zinc-400">
                <dt>Next</dt>
                <dd className="text-right text-zinc-200">{item.nextWindow}</dd>
              </div>
              <div className="flex justify-between gap-3 text-zinc-400">
                <dt>Broadcast</dt>
                <dd className="text-right text-zinc-200">{String(item.broadcast)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-5 text-zinc-500">{item.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function RowsTable({ rows }: { rows: MintRow[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-800">
      <div className="grid grid-cols-[1.2fr_0.7fr_0.9fr_0.9fr] gap-3 bg-zinc-950 px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
        <span>Wallet</span>
        <span>Amount</span>
        <span>Gas</span>
        <span>Status</span>
      </div>
      <div className="divide-y divide-zinc-800 bg-zinc-950/40">
        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[1.2fr_0.7fr_0.9fr_0.9fr] gap-3 px-4 py-4 text-sm">
            <span className="font-mono text-zinc-200">{shortenWallet(row.wallet)}</span>
            <span className="text-zinc-300">{row.amount}</span>
            <span className="text-zinc-300">{row.gas}</span>
            <StatusPill status={row.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function CollectionCard() {
  const [activeTab, setActiveTab] = useState<CollectionTab>("Minted");
  const rows = COLLECTION_ROWS[activeTab];

  const tabSummary = useMemo(() => {
    const total = rows.length;
    const scheduled = rows.filter((row) => row.status === "scheduled" || row.status === "queued").length;
    return { total, scheduled };
  }, [rows]);

  return (
    <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/80 p-5 shadow-2xl shadow-black/30 lg:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-300/80">Final mints</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Compas collection card</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Tabs cover Minted, Transactions, and Analytics rows with wallet, amount, gas, and status columns. All values are
            static placeholders.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm text-zinc-300">
          <span className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
            Rows <b className="text-white">{tabSummary.total}</b>
          </span>
          <span className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
            Scheduled <b className="text-white">{tabSummary.scheduled}</b>
          </span>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {COLLECTION_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cx(
              "rounded-full border px-4 py-2 text-sm font-semibold transition",
              activeTab === tab
                ? "border-amber-200 bg-amber-100 text-zinc-950"
                : "border-zinc-800 bg-zinc-950/70 text-zinc-400 hover:text-white",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {activeTab === "Analytics" && (
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            {ANALYTICS_METRICS.map((metric) => (
              <article key={metric.label} className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">{metric.label}</p>
                <p className="mt-2 text-2xl font-semibold text-white">{metric.value}</p>
                <p className="mt-1 text-sm text-zinc-400">{metric.detail}</p>
              </article>
            ))}
          </div>
        )}
        <RowsTable rows={rows} />
      </div>
    </section>
  );
}

function QueuePanel() {
  return (
    <section className="rounded-[2rem] border border-zinc-800 bg-zinc-900/80 p-5 shadow-2xl shadow-black/30 lg:p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-rose-300/80">Transaction queue</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">Scheduled rows, no execution</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Queue rows can be reviewed and reordered visually, but this preview has no RPC, no signer, and no broadcast path.
          </p>
        </div>
        <span className="w-fit rounded-full border border-rose-300/20 bg-rose-300/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-rose-100">
          broadcast false
        </span>
      </div>
      <div className="grid gap-3">
        {TRANSACTION_QUEUE.map((row, index) => (
          <article key={row.id} className="grid gap-4 rounded-3xl border border-zinc-800 bg-zinc-950/70 p-4 md:grid-cols-[auto_1fr_auto] md:items-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-sm font-black text-zinc-950">
              {index + 1}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-sm text-zinc-100">{shortenWallet(row.wallet)}</p>
                <StatusPill status={row.status} />
                <span className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-400">{row.lane}</span>
              </div>
              <p className="mt-2 text-sm text-zinc-400">
                {row.amount} · {row.gas} · {row.note}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black/30 px-4 py-3 text-right">
              <p className="text-xs uppercase tracking-[0.22em] text-zinc-500">Scheduled</p>
              <p className="mt-1 font-semibold text-white">{row.eta}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function MintConsole() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.18),_transparent_32rem),radial-gradient(circle_at_top_right,_rgba(168,85,247,0.16),_transparent_30rem),#050505] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="overflow-hidden rounded-[2.5rem] border border-zinc-800 bg-zinc-950/70 p-6 shadow-2xl shadow-black/40 lg:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-zinc-500">Compas mint kit</p>
              <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
                Mint console preview for Disperse, ACO, queues, and analytics.
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-400">
                Holder-facing control-room layout for public mint planning. It shows the intended Umi-style Disperse shape,
                final mint tabs, scheduled transaction rows, and analytic fixtures without enabling execution.
              </p>
            </div>
            <div className="rounded-3xl border border-zinc-800 bg-black/30 p-4 text-sm text-zinc-300 lg:w-80">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Environment</p>
              <p className="mt-2 text-lg font-semibold text-white">Preview-only UI</p>
              <p className="mt-2 leading-6 text-zinc-400">
                No private keys, wallet SDK, RPC writes, calldata generation, relay, or broadcaster is wired in this webapp.
              </p>
            </div>
          </div>
        </header>

        <SafetyStrip />
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <DispersePanel />
          <AcoPanel />
        </div>
        <CollectionCard />
        <QueuePanel />
      </div>
    </main>
  );
}
