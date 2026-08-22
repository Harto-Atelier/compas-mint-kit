"use client";

import { useMemo, useState } from "react";
import { AcoPanel, DispersePanel } from "@/app/components/DisperseAcoPanels";
import MintConsole from "@/app/components/MintConsole";
import RunReportViewer from "@/app/components/RunReportViewer";
import LaunchVaultConsole from "@/app/LaunchVaultConsole";
import WalletConsole from "@/app/WalletConsole";
import { usePlannerStore } from "@/app/components/PlannerStoreProvider";
import { countUnlockedVaultWallets } from "@/lib/planner-store";

export type MainTab = "Mints" | "Wallets" | "Vault" | "Disperse" | "ACO" | "Reports";

const mainTabs: MainTab[] = ["Mints", "Wallets", "Vault", "Disperse", "ACO", "Reports"];

const DOCS_URL = "https://github.com/Harto-Atelier/compas-mint-kit#readme";

const tabCopy: Record<MainTab, { eyebrow: string; title: string; body: string }> = {
  Mints: {
    eyebrow: "Mint command",
    title: "Plan the drop before anything signs.",
    body: "Discover collections and stages, set wallets and gas assumptions, and save a read-only schedule preview.",
  },
  Wallets: {
    eyebrow: "Wallet desk",
    title: "Stage the wallets for this launch.",
    body: "Import public addresses or encrypted vault wallets without exposing seeds, private keys, or custodial controls.",
  },
  Vault: {
    eyebrow: "Encrypted vault",
    title: "Seal launch keys in the browser only.",
    body: "Create a per-launch encrypted blob, unlock with a passphrase, and show derived wallet addresses without exposing private keys.",
  },
  Disperse: {
    eyebrow: "Funding prep",
    title: "Draft safe funding routes.",
    body: "Prepare read-only disperse plans with clear before-signing checks and no hidden execution path.",
  },
  ACO: {
    eyebrow: "Automation",
    title: "No unattended execution.",
    body: "This console runs no watchers or bots; execution happens only via the exported run config on a local CLI.",
  },
  Reports: {
    eyebrow: "CLI run report",
    title: "Import real local results after the mint run.",
    body: "Load a no-secret CLI report JSON and review minted totals, transaction status, tx hashes, receipts, and explorer links.",
  },
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

function Sidebar({
  active,
  setActive,
  stagedWallets,
}: {
  active: MainTab;
  setActive: (tab: MainTab) => void;
  stagedWallets: number;
}) {
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
          <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700 dark:text-violet-200">Staged wallets</p>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-3xl font-black tracking-tight text-slate-950 dark:text-white">{stagedWallets}</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">in the planner store</p>
            </div>
          </div>
          {stagedWallets === 0 ? (
            <button
              type="button"
              onClick={() => setActive("Wallets")}
              className="mt-3 w-full rounded-full bg-white px-3 py-2 text-xs font-black text-violet-700 shadow-sm transition hover:bg-violet-100 dark:bg-white/10 dark:text-violet-100"
            >
              Import wallets to start
            </button>
          ) : null}
        </div>

        <div className="mt-auto rounded-[1.5rem] border border-slate-200/80 bg-slate-50 p-4 text-xs font-semibold text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
          <p className="font-black text-slate-900 dark:text-white">Local-only shell</p>
          <p className="mt-1 leading-5">Encrypted vault is browser-local. No plaintext key display, unattended signing, or live disperse execution.</p>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block rounded-full border border-slate-200 bg-white px-3 py-1.5 font-black text-slate-700 transition hover:border-violet-200 hover:text-violet-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-200"
          >
            Docs & README ↗
          </a>
        </div>
      </div>
    </aside>
  );
}

function ReportStrip({
  stagedWallets,
  savedSchedules,
  unlockedVaultWallets,
}: {
  stagedWallets: number;
  savedSchedules: number;
  unlockedVaultWallets: number;
}) {
  return (
    <section className="overflow-hidden rounded-[2rem] bg-gradient-to-r from-[#6d3df4] via-[#8b5cf6] to-[#d946ef] p-[1px] shadow-[0_22px_70px_rgba(124,58,237,0.24)]">
      <div className="relative overflow-hidden rounded-[1.95rem] bg-violet-600 px-5 py-4 text-white sm:px-6">
        <div className="absolute -right-12 -top-16 h-36 w-36 rounded-full bg-white/20 blur-2xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-100">Console state</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
              {stagedWallets === 0 && savedSchedules === 0
                ? "Nothing staged yet. Start with wallets or discovery."
                : "Live planner state for this browser session."}
            </h1>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[390px]">
            {[
              [String(stagedWallets), "wallets staged"],
              [String(savedSchedules), "saved schedules"],
              [String(unlockedVaultWallets), "unlocked vault"],
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

function StatusRow({ activeLaunchId }: { activeLaunchId: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[1.75rem] border border-white/80 bg-white/82 p-3 shadow-sm backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 px-1">
          <p className="truncate text-sm font-black text-slate-950">
            Active launch · <span className="font-mono text-xs">{activeLaunchId}</span>
          </p>
          <p className="text-xs font-semibold text-slate-500">Browser-local planner · no custody · nothing broadcast from the web</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-950 px-4 py-2 text-xs font-black text-white shadow-sm">
          No keys on server
        </span>
      </div>
    </div>
  );
}

function MainPanel({ active }: { active: MainTab }) {
  if (active === "Mints") {
    return <MintConsole embedded />;
  }

  if (active === "Wallets") {
    return <WalletConsole embedded />;
  }

  if (active === "Vault") {
    return <LaunchVaultConsole embedded />;
  }

  if (active === "Disperse") {
    return <DispersePanel embedded />;
  }

  if (active === "Reports") {
    return <RunReportViewer embedded />;
  }

  return <AcoPanel embedded />;
}

export default function MintConsoleShell({ initialTab = "Mints" }: { initialTab?: MainTab }) {
  const [activeTab, setActiveTab] = useState<MainTab>(initialTab);
  const { wallets, scheduleReceipt, activeLaunchId } = usePlannerStore();

  const tabSummary = useMemo(() => tabCopy[activeTab].title, [activeTab]);
  const unlockedVaultWallets = useMemo(() => countUnlockedVaultWallets(wallets), [wallets]);
  const savedSchedules = scheduleReceipt ? 1 : 0;

  return (
    <main>
      <div className="min-h-dvh bg-[radial-gradient(circle_at_top_left,#ede9fe_0,#f8fafc_36%,#ffffff_72%)] px-4 py-5 text-slate-950 transition-colors duration-300 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-[1480px] gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Sidebar active={activeTab} setActive={setActiveTab} stagedWallets={wallets.length} />
          <div className="grid gap-5">
            <ReportStrip stagedWallets={wallets.length} savedSchedules={savedSchedules} unlockedVaultWallets={unlockedVaultWallets} />
            <StatusRow activeLaunchId={activeLaunchId} />
            <div className="rounded-[1.5rem] border border-violet-200/70 bg-violet-50/75 px-4 py-3 text-sm font-bold text-violet-800 backdrop-blur">
              Active module: <span className="font-black">{activeTab}</span> · {tabSummary}
            </div>
            <MainPanel active={activeTab} />
          </div>
        </div>
      </div>
    </main>
  );
}
