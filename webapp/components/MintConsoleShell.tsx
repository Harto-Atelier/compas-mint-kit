"use client";

import { useMemo, useState } from "react";
import MintConsole from "@/app/components/MintConsole";

type MainTab = "Mints" | "Wallets" | "Disperse" | "ACO";
type SupportTab = "Staking" | "Subscription" | "FAQ" | "Support";

type MintRow = {
  collection: string;
  network: string;
  stage: string;
  supply: string;
  price: string;
  status: "Ready" | "Watching" | "Draft";
};

const mainTabs: MainTab[] = ["Mints", "Wallets", "Disperse", "ACO"];
const supportTabs: SupportTab[] = ["Staking", "Subscription", "FAQ", "Support"];

const mintRows: MintRow[] = [
  {
    collection: "Compas Genesis",
    network: "Ethereum",
    stage: "Allowlist",
    supply: "2,000",
    price: "0.08 ETH",
    status: "Ready",
  },
  {
    collection: "Harto Relay Pass",
    network: "Base",
    stage: "Snapshot",
    supply: "720",
    price: "Free claim",
    status: "Watching",
  },
  {
    collection: "Atelier Proof",
    network: "Ethereum",
    stage: "Reserve",
    supply: "300",
    price: "Manual",
    status: "Draft",
  },
];

const walletBuckets = [
  { label: "Warm", value: "148", detail: "ready to simulate" },
  { label: "Needs gas", value: "32", detail: "below run target" },
  { label: "Paused", value: "20", detail: "excluded from demo" },
];

const activity = [
  "Report prepared for Compas Genesis",
  "Wallet health check completed",
  "Disperse route drafted in simulation mode",
  "No private keys are stored in this console",
];

const tabCopy: Record<MainTab, { eyebrow: string; title: string; body: string }> = {
  Mints: {
    eyebrow: "Mint command",
    title: "Plan the drop before anything signs.",
    body: "Queue collections, stages, wallets, and gas assumptions in a calm operator surface. This shell uses mock state only.",
  },
  Wallets: {
    eyebrow: "Wallet desk",
    title: "Segment the 200-wallet demo fleet.",
    body: "Review warm, low-gas, and paused buckets without exposing seeds, private keys, or custodial controls.",
  },
  Disperse: {
    eyebrow: "Funding prep",
    title: "Draft safe funding routes.",
    body: "Prepare read-only disperse plans with clear before-signing checks and no hidden execution path.",
  },
  ACO: {
    eyebrow: "Access console",
    title: "Coordinate allowlists and collector ops.",
    body: "Keep the operator view focused on access, timing, and account status instead of noisy backend details.",
  },
};

const supportCopy: Record<SupportTab, string> = {
  Staking: "Preview staking access cards, unlock rules, and claim readiness without connecting custody.",
  Subscription: "Show plan status, demo access limits, and billing placeholders as product UI only.",
  FAQ: "Answer operator questions in short cards: no seed storage, no unattended signing, no mainnet execution here.",
  Support: "Expose a human support lane for launch day issues, wallet import questions, and collection setup.",
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function BrandMark() {
  return (
    <div className="relative grid h-12 w-12 place-items-center rounded-3xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-[#241050] text-white shadow-[0_18px_55px_rgba(124,58,237,0.34)]">
      <div className="absolute inset-1.5 rounded-[1.15rem] border border-white/35" />
      <span className="text-lg font-black tracking-[-0.18em]">C</span>
      <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-white/90" />
    </div>
  );
}

function StatusPill({ status }: { status: MintRow["status"] }) {
  const tone = {
    Ready: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/25",
    Watching: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-400/10 dark:text-violet-200 dark:ring-violet-400/25",
    Draft: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10",
  }[status];

  return (
    <span className={cx("rounded-full px-2.5 py-1 text-[11px] font-bold ring-1", tone)}>
      {status}
    </span>
  );
}

function Sidebar({ active, setActive }: { active: MainTab; setActive: (tab: MainTab) => void }) {
  return (
    <aside className="lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)]">
      <div className="flex h-full flex-col rounded-[2rem] border border-white/75 bg-white/92 p-4 shadow-[0_24px_90px_rgba(77,63,132,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-[#15111f]/92 dark:shadow-[0_24px_90px_rgba(0,0,0,0.4)]">
        <div className="flex items-center gap-3 border-b border-slate-200/70 pb-5 dark:border-white/10">
          <BrandMark />
          <div>
            <p className="text-sm font-black tracking-tight text-slate-950 dark:text-white">Compas Mint Kit</p>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Harto operator shell</p>
          </div>
        </div>

        <nav className="mt-5 grid gap-2" aria-label="Mint console sections">
          {mainTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActive(tab)}
              className={cx(
                "group flex items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-extrabold transition",
                active === tab
                  ? "bg-violet-600 text-white shadow-[0_16px_36px_rgba(124,58,237,0.26)]"
                  : "text-slate-600 hover:bg-violet-50 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-white/8 dark:hover:text-white",
              )}
            >
              <span className="flex items-center gap-3">
                <span
                  className={cx(
                    "h-2.5 w-2.5 rounded-full",
                    active === tab ? "bg-white" : "bg-violet-300 group-hover:bg-violet-500",
                  )}
                />
                {tab}
              </span>
              <span className={cx("text-xs", active === tab ? "text-white/75" : "text-slate-400")}>⌘</span>
            </button>
          ))}
        </nav>

        <div className="mt-5 rounded-[1.5rem] border border-violet-100 bg-violet-50/70 p-4 dark:border-violet-400/15 dark:bg-violet-400/8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700 dark:text-violet-200">Demo Access</p>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-3xl font-black tracking-tight text-slate-950 dark:text-white">200</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">wallet seats</p>
            </div>
            <div className="rounded-full bg-white px-3 py-1 text-xs font-black text-violet-700 shadow-sm dark:bg-white/10 dark:text-violet-100">
              mock
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white dark:bg-white/10">
            <div className="h-full w-[74%] rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-400" />
          </div>
        </div>

        <div className="mt-auto rounded-[1.5rem] border border-slate-200/80 bg-slate-50 p-4 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
          <p className="font-black text-slate-900 dark:text-white">Read-only shell</p>
          <p className="mt-1 leading-5">No private-key storage. No unattended signing. No live disperse execution.</p>
        </div>
      </div>
    </aside>
  );
}

function ReportStrip() {
  return (
    <section className="overflow-hidden rounded-[2rem] bg-gradient-to-r from-[#6d3df4] via-[#8b5cf6] to-[#d946ef] p-[1px] shadow-[0_22px_70px_rgba(124,58,237,0.24)]">
      <div className="relative overflow-hidden rounded-[1.95rem] bg-violet-600 px-5 py-4 text-white sm:px-6">
        <div className="absolute -right-12 -top-16 h-36 w-36 rounded-full bg-white/20 blur-2xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-100">Operator report</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Today&apos;s mint console is ready.</h1>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[390px]">
            {[
              ["3", "runs"],
              ["148", "warm"],
              ["0", "keys held"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-2xl bg-white/14 px-4 py-3 ring-1 ring-white/18 backdrop-blur">
                <p className="text-xl font-black">{value}</p>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-violet-100">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AccountRow({ dark, setDark }: { dark: boolean; setDark: (value: boolean) => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-[1.75rem] border border-white/80 bg-white/82 p-3 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-950 text-sm font-black text-white dark:bg-white dark:text-slate-950">HC</div>
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-slate-950 dark:text-white">Harto Console · 0x7A31…C9e4</p>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Demo workspace · no custody · Sepolia-safe UI state</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:border-violet-200 hover:text-violet-700 dark:border-white/10 dark:bg-white/8 dark:text-slate-200 dark:hover:text-white"
        >
          Account
        </button>
        <button
          type="button"
          aria-pressed={dark}
          onClick={() => setDark(!dark)}
          className="flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-violet-700 dark:bg-white dark:text-slate-950 dark:hover:bg-violet-100"
        >
          <span>{dark ? "☾" : "☀"}</span>
          {dark ? "Dark" : "Light"}
        </button>
      </div>
    </div>
  );
}

function MainPanel({ active }: { active: MainTab }) {
  const copy = tabCopy[active];

  if (active === "Mints") {
    return <MintConsole embedded />;
  }

  return (
    <section className="rounded-[2rem] border border-white/80 bg-white/88 p-5 shadow-[0_24px_90px_rgba(77,63,132,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#171320]/88 dark:shadow-[0_24px_90px_rgba(0,0,0,0.35)] sm:p-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-600 dark:text-violet-300">{copy.eyebrow}</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 dark:text-white sm:text-4xl">{copy.title}</h2>
          <p className="mt-3 max-w-xl text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">{copy.body}</p>
        </div>
        <div className="grid min-w-full grid-cols-3 gap-2 rounded-[1.5rem] bg-slate-50 p-2 dark:bg-white/5 xl:min-w-[360px]">
          {walletBuckets.map((bucket) => (
            <div key={bucket.label} className="rounded-[1.15rem] bg-white p-3 shadow-sm dark:bg-white/8">
              <p className="text-2xl font-black tracking-tight text-slate-950 dark:text-white">{bucket.value}</p>
              <p className="mt-1 text-xs font-black text-slate-700 dark:text-slate-200">{bucket.label}</p>
              <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-400 dark:text-slate-500">{bucket.detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-7 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white dark:border-white/10 dark:bg-white/5">
          <div className="grid grid-cols-[1.25fr_0.8fr_0.8fr_0.8fr_auto] gap-3 border-b border-slate-100 px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400 dark:border-white/10 dark:text-slate-500 max-md:hidden">
            <span>Collection</span>
            <span>Network</span>
            <span>Stage</span>
            <span>Price</span>
            <span>Status</span>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-white/10">
            {mintRows.map((row) => (
              <div key={row.collection} className="grid gap-3 px-4 py-4 md:grid-cols-[1.25fr_0.8fr_0.8fr_0.8fr_auto] md:items-center">
                <div>
                  <p className="font-black text-slate-950 dark:text-white">{row.collection}</p>
                  <p className="text-xs font-semibold text-slate-400">Supply {row.supply}</p>
                </div>
                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{row.network}</p>
                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{row.stage}</p>
                <p className="text-sm font-black text-slate-950 dark:text-white">{row.price}</p>
                <StatusPill status={row.status} />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[1.5rem] bg-slate-950 p-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] dark:bg-black/35">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-200">Run map</p>
            <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-black text-white/80">simulation</span>
          </div>
          <div className="mt-5 flex h-36 items-end gap-2 rounded-[1.15rem] bg-white/[0.06] p-3">
            {[36, 54, 46, 78, 65, 92, 58, 82, 70, 96, 76, 88].map((height, index) => (
              <div key={index} className="flex h-full flex-1 items-end">
                <div
                  className="w-full rounded-t-lg bg-gradient-to-t from-violet-700 to-fuchsia-300"
                  style={{ height: `${height}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/8 p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-200">Gas target</p>
              <p className="mt-1 text-xl font-black">manual</p>
            </div>
            <div className="rounded-2xl bg-white/8 p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-200">Signing</p>
              <p className="mt-1 text-xl font-black">off</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SupportPanel({ active, setActive }: { active: SupportTab; setActive: (tab: SupportTab) => void }) {
  return (
    <section className="rounded-[2rem] border border-white/80 bg-white/78 p-5 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/6 sm:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-600 dark:text-violet-300">Launch desk</p>
          <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white">Support cards stay secondary.</h3>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-white/8 sm:grid-cols-4">
          {supportTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActive(tab)}
              className={cx(
                "rounded-xl px-3 py-2 text-xs font-black transition",
                active === tab
                  ? "bg-white text-violet-700 shadow-sm dark:bg-violet-500 dark:text-white"
                  : "text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[0.75fr_1fr]">
        <div className="rounded-[1.5rem] bg-violet-50 p-4 dark:bg-violet-400/8">
          <p className="text-sm font-black text-slate-950 dark:text-white">{active}</p>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500 dark:text-slate-400">{supportCopy[active]}</p>
        </div>
        <div className="grid gap-2">
          {activity.map((item) => (
            <div key={item} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm font-bold text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              <span className="h-2 w-2 rounded-full bg-violet-500" />
              {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function MintConsoleShell() {
  const [activeTab, setActiveTab] = useState<MainTab>("Mints");
  const [supportTab, setSupportTab] = useState<SupportTab>("Staking");
  const [dark, setDark] = useState(false);

  const tabSummary = useMemo(() => tabCopy[activeTab].title, [activeTab]);

  return (
    <main className={cx(dark && "dark")}>
      <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,#ede9fe_0,#f8fafc_36%,#ffffff_72%)] px-4 py-5 text-slate-950 transition-colors duration-300 dark:bg-[radial-gradient(circle_at_top_left,#26153f_0,#0f0b17_42%,#050309_100%)] dark:text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-[1480px] gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Sidebar active={activeTab} setActive={setActiveTab} />
          <div className="grid gap-5">
            <ReportStrip />
            <AccountRow dark={dark} setDark={setDark} />
            <div className="rounded-[1.5rem] border border-violet-200/70 bg-violet-50/75 px-4 py-3 text-sm font-bold text-violet-800 backdrop-blur dark:border-violet-400/15 dark:bg-violet-400/8 dark:text-violet-100">
              Active module: <span className="font-black">{activeTab}</span> · {tabSummary}
            </div>
            <MainPanel active={activeTab} />
            <SupportPanel active={supportTab} setActive={setSupportTab} />
          </div>
        </div>
      </div>
    </main>
  );
}
