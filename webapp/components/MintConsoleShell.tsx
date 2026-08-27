"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { DispersePanel } from "@/app/components/DisperseAcoPanels";
import GuidedHolderFlow from "@/app/components/GuidedHolderFlow";
import MintConsole from "@/app/components/MintConsole";
import OpportunityWatchPanel from "@/app/components/OpportunityWatchPanel";
import MarketFighterPanel from "@/app/components/MarketFighterPanel";
import RunReportViewer from "@/app/components/RunReportViewer";
import LaunchVaultConsole from "@/app/LaunchVaultConsole";
import WalletConsole from "@/app/WalletConsole";
import { usePlannerStore } from "@/app/components/PlannerStoreProvider";
import { countUnlockedVaultWallets } from "@/lib/planner-store";
import CompasGate from "@/components/CompasGate";

export type MainTab = "Guide" | "Mints" | "Watch" | "Market" | "Wallets" | "Vault" | "Disperse" | "Reports";
type ConsoleSkin = "light" | "dark" | "coded";

const mainTabs: MainTab[] = ["Guide", "Mints", "Watch", "Market", "Wallets", "Vault", "Disperse", "Reports"];

const DOCS_URL = "https://github.com/Harto-Atelier/compas-mint-kit#readme";

const tabCopy: Record<MainTab, { eyebrow: string; title: string; body: string }> = {
  Guide: {
    eyebrow: "Holder guide",
    title: "Move from verified holder to confirmed mint receipts, one decision at a time.",
    body: "Bound encrypted burners, exact funding, simulation, explicit live consent, verified recipients, and a balance-safe finish.",
  },
  Mints: {
    eyebrow: "Mint command",
    title: "Plan the drop before anything signs.",
    body: "Discover collections and stages, set wallets and gas assumptions, and save a read-only schedule preview.",
  },
  Watch: {
    eyebrow: "Opportunity scan",
    title: "Rank drops before you spend attention.",
    body: "Maintain a local watchlist and run preview-only scans that never sign, custody, or broadcast.",
  },
  Market: {
    eyebrow: "Market fighter",
    title: "Defend holder positions on secondary.",
    body: "Score bot pressure and propose OpenSea listing prices that clear target profit. Listings must be signed manually.",
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
    <div className="exq-brand-mark overflow-hidden" aria-label="Compas">
      <Image
        src="/compas-logo.png"
        alt="Compas pixel emblem"
        width={48}
        height={48}
        priority
        className="h-full w-full object-cover [image-rendering:pixelated]"
      />
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
    <aside className="console-sidebar min-w-0 max-w-full lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)]">
      <div className="exq-panel flex h-full min-w-0 max-w-full flex-col overflow-hidden p-3 sm:p-4">
        <div className="flex items-center gap-3 border-b border-[color:var(--compas-line)] pb-3 sm:pb-5">
          <BrandMark />
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-[color:var(--compas-ink)]">Compas Mint Kit</p>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">Holder mint journey</p>
          </div>
        </div>

        <nav className="mt-3 grid min-w-0 gap-2 sm:mt-5" aria-label="Mint console optional sections">
          <details className="rounded-2xl border border-dashed border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-2 text-xs">
            <summary className="cursor-pointer px-2 py-1 font-black uppercase tracking-[0.16em] text-[color:var(--compas-muted)]">Optional sections</summary>
            <button
              type="button"
              onClick={() => setActive("Guide")}
              className={cx(
                "mt-2 flex min-h-10 w-full min-w-0 items-center justify-between rounded-xl border px-3 py-2 text-left font-extrabold transition",
                active === "Guide"
                  ? "border-[color:var(--compas-accent)] bg-[color:var(--compas-card)] text-[color:var(--compas-ink)]"
                  : "border-transparent text-[color:var(--compas-muted)] hover:border-[color:var(--compas-line)] hover:bg-[color:var(--compas-card)] hover:text-[color:var(--compas-ink)]",
              )}
            >
              <span>Holder guide</span>
              <span className="text-[10px] font-black uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">Help</span>
            </button>
            <details className="mt-2 rounded-xl border border-[color:var(--compas-line)] bg-[color:var(--compas-card)] p-2">
              <summary className="cursor-pointer px-1 py-1 font-black uppercase tracking-[0.16em] text-[color:var(--compas-muted)]">Advanced tools</summary>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-1">
                {mainTabs.filter((tab) => tab !== "Guide").map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActive(tab)}
                    className={cx(
                      "group flex min-h-9 min-w-0 items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-extrabold transition",
                      active === tab
                        ? "bg-[color:var(--compas-accent)] text-[color:var(--compas-accent-ink)]"
                        : "text-[color:var(--compas-muted)] hover:bg-[color:var(--compas-soft)] hover:text-[color:var(--compas-ink)]",
                    )}
                  >
                    <span className="truncate">{tab}</span>
                    <span className="text-xs font-black">→</span>
                  </button>
                ))}
              </div>
            </details>
          </details>
        </nav>

        <div className="mt-3 rounded-[1.25rem] border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-3 sm:mt-5 sm:rounded-[1.5rem] sm:p-4 dark:border-violet-400/15 dark:bg-violet-400/8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[color:var(--compas-accent)]">Staged wallets</p>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-2xl font-black tracking-tight text-[color:var(--compas-ink)] sm:text-3xl">{stagedWallets}</p>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--compas-muted)]">in the planner store</p>
            </div>
          </div>
          {stagedWallets === 0 && active !== "Guide" ? (
            <button
              type="button"
              onClick={() => setActive("Guide")}
              className="mt-3 w-full rounded-full bg-white px-3 py-2 text-xs font-black text-violet-700 shadow-sm transition hover:bg-violet-100 dark:bg-white/10 dark:text-[color:var(--compas-hero-muted)]"
            >
              Return to holder guide
            </button>
          ) : null}
        </div>

        <div className="mt-3 hidden rounded-[1.5rem] border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] p-4 text-xs font-semibold text-[color:var(--compas-muted)] sm:block lg:mt-auto">
          <p className="font-black uppercase tracking-[0.16em] text-[color:var(--compas-ink)]">Local-only shell</p>
          <p className="mt-1 leading-5">Encrypted vault is browser-local. No plaintext key display, unattended signing, or live disperse execution.</p>
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block rounded-full border border-[color:var(--compas-line)] bg-[color:var(--compas-card)] px-3 py-1.5 font-black text-[color:var(--compas-ink)] transition hover:border-[color:var(--compas-accent)]"
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
  skin,
  setSkin,
}: {
  stagedWallets: number;
  savedSchedules: number;
  unlockedVaultWallets: number;
  skin: ConsoleSkin;
  setSkin: (skin: ConsoleSkin) => void;
}) {
  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-[1.5rem] bg-[color:var(--compas-line)] p-[1px] shadow-[0_18px_55px_rgba(124,58,237,0.20)] sm:rounded-[2rem] sm:shadow-[0_22px_70px_rgba(124,58,237,0.24)]">
      <div className="relative min-w-0 max-w-full overflow-hidden rounded-[1.45rem] bg-[color:var(--compas-hero)] px-4 py-4 text-[color:var(--compas-hero-ink)] sm:rounded-[1.95rem] sm:px-6">
        <div className="absolute -right-12 -top-16 h-36 w-36 rounded-full bg-white/20 blur-2xl" />
        <div className="relative mb-3 flex justify-end">
          <SkinSwitcher skin={skin} setSkin={setSkin} />
        </div>
        <div className="relative flex min-w-0 max-w-full flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 max-w-full">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[color:var(--compas-hero-muted)]">Console state</p>
            <h1 className="mt-1 max-w-full break-words text-2xl font-black tracking-tight [overflow-wrap:anywhere] sm:text-3xl">
              {stagedWallets === 0 && savedSchedules === 0 ? (
                <>
                  <span className="sm:hidden">Nothing staged yet.</span>
                  <span className="hidden sm:inline">Nothing staged yet. Start with wallets or discovery.</span>
                </>
              ) : (
                <>
                  <span className="sm:hidden">Planner state is live.</span>
                  <span className="hidden sm:inline">Live planner state for this browser session.</span>
                </>
              )}
            </h1>
          </div>
          <div className="grid min-w-0 max-w-full grid-cols-1 gap-2 text-center min-[360px]:grid-cols-3 sm:min-w-[390px]">
            {[
              [String(stagedWallets), "wallets staged"],
              [String(savedSchedules), "saved schedules"],
              [String(unlockedVaultWallets), "unlocked vault"],
            ].map(([value, label]) => (
              <div key={label} className="rounded-none border border-[color:var(--compas-hero-line)] bg-[color:var(--compas-hero-card)] px-4 py-3">
                <p className="text-xl font-black">{value}</p>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--compas-hero-muted)]">{label}</p>
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
    <div className="flex flex-col gap-3 rounded-[1.75rem] border border-[color:var(--compas-line)] bg-[color:var(--compas-card)] p-3 shadow-sm backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 px-1">
          <p className="truncate text-sm font-black text-[color:var(--compas-ink)]">
            Active launch · <span className="font-mono text-xs">{formatLaunchId(activeLaunchId)}</span>
          </p>
          <p className="text-xs font-semibold text-[color:var(--compas-muted)]">Browser-local planner · no custody · nothing broadcast from the web</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[color:var(--compas-ink)] px-4 py-2 text-xs font-black text-[color:var(--compas-bg)] shadow-sm">
          No keys on server
        </span>
      </div>
    </div>
  );
}

function OperatorFlow({ active, setActive }: { active: MainTab; setActive: (tab: MainTab) => void }) {
  const steps: Array<{ tab: MainTab; label: string; detail: string }> = [
    { tab: "Mints", label: "Drop", detail: "Paste collection" },
    { tab: "Watch", label: "Select mint", detail: "Pick drop" },
    { tab: "Wallets", label: "Wallets", detail: "Stage addresses" },
    { tab: "Vault", label: "Vault", detail: "Unlock burners" },
    { tab: "Reports", label: "Review", detail: "Receipts + txs" },
  ];

  return (
    <section className="grid gap-2 exq-panel grid gap-2 p-3 sm:grid-cols-5">
      {steps.map((step, index) => (
        <button
          key={step.tab}
          type="button"
          onClick={() => setActive(step.tab)}
          className={cx(
            "rounded-2xl border px-3 py-3 text-left transition",
            active === step.tab ? "border-[color:var(--compas-accent)] bg-[color:var(--compas-accent)] text-[color:var(--compas-accent-ink)] shadow-[6px_6px_0_var(--compas-shadow)]" : "border-[color:var(--compas-line)] bg-[color:var(--compas-card)] text-[color:var(--compas-ink)] hover:border-[color:var(--compas-accent)] hover:bg-[color:var(--compas-soft)]",
          )}
        >
          <p className={cx("text-[10px] font-black uppercase tracking-[0.18em]", active === step.tab ? "text-[color:var(--compas-hero-muted)]" : "text-slate-400")}>0{index + 1}</p>
          <p className="mt-1 text-sm font-black">{step.label}</p>
          <p className={cx("mt-1 text-xs font-semibold", active === step.tab ? "text-[color:var(--compas-hero-muted)]" : "text-[color:var(--compas-muted)]")}>{step.detail}</p>
        </button>
      ))}
    </section>
  );
}

function MobileBottomNav({ active, setActive }: { active: MainTab; setActive: (tab: MainTab) => void }) {
  const items: Array<{ tab: MainTab; label: string }> = [
    { tab: "Guide", label: "Guide" },
    { tab: "Mints", label: "Drop" },
    { tab: "Vault", label: "Vault" },
    { tab: "Disperse", label: "Fund" },
    { tab: "Reports", label: "Reports" },
  ];

  return (
    <nav
      className={cx(
        "fixed inset-x-3 bottom-3 z-40 grid-cols-5 gap-1 rounded-none border border-[color:var(--compas-line)] bg-[color:var(--compas-card)] p-1 shadow-[8px_8px_0_var(--compas-shadow)] backdrop-blur-xl lg:hidden",
        active === "Guide" ? "hidden sm:grid" : "grid",
      )}
      aria-label="Mobile operator flow"
    >
      {items.map((item) => (
        <button
          key={item.tab}
          type="button"
          onClick={() => setActive(item.tab)}
          className={cx(
            "min-h-11 rounded-2xl px-2 text-[11px] font-black transition",
            active === item.tab ? "bg-[color:var(--compas-accent)] text-[color:var(--compas-accent-ink)]" : "text-[color:var(--compas-muted)] hover:bg-[color:var(--compas-soft)] hover:text-[color:var(--compas-ink)]",
          )}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

const skinOptions: Array<{ skin: ConsoleSkin; label: string; swatch: string }> = [
  { skin: "light", label: "Light", swatch: "#f3efe3" },
  { skin: "dark", label: "Dark", swatch: "#ff6a1a" },
  { skin: "coded", label: "Code", swatch: "#75ff8f" },
];

function SkinSwitcher({ skin, setSkin }: { skin: ConsoleSkin; setSkin: (skin: ConsoleSkin) => void }) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-2xl border border-[color:var(--compas-hero-line)] bg-[color:var(--compas-hero-card)] p-1 backdrop-blur-xl"
      role="group"
      aria-label="Console color mode"
    >
      {skinOptions.map((item) => (
        <button
          key={item.skin}
          type="button"
          onClick={() => setSkin(item.skin)}
          aria-pressed={skin === item.skin}
          title={`${item.label} color mode`}
          className={cx(
            "flex h-8 items-center gap-1.5 rounded-xl border px-2 text-[9px] font-black uppercase tracking-[0.14em] transition sm:h-9 sm:px-2.5 sm:text-[10px]",
            skin === item.skin
              ? "border-[color:var(--compas-accent)] bg-[color:var(--compas-accent)] text-[color:var(--compas-accent-ink)]"
              : "border-transparent text-[color:var(--compas-muted)] hover:border-[color:var(--compas-line)] hover:text-[color:var(--compas-ink)]",
          )}
        >
          <span
            className="h-2.5 w-2.5 shrink-0 border border-current"
            style={{ backgroundColor: item.swatch }}
            aria-hidden="true"
          />
          {item.label}
        </button>
      ))}
    </div>
  );
}

function MainPanel({ active, setActive }: { active: MainTab; setActive: (tab: MainTab) => void }) {
  if (active === "Guide") {
    return (
      <div className="guide-mobile-surface">
        <GuidedHolderFlow embedded onOpenAdvanced={setActive} />
      </div>
    );
  }

  if (active === "Mints") {
    return <MintConsole embedded />;
  }

  if (active === "Watch") {
    return <OpportunityWatchPanel embedded />;
  }

  if (active === "Market") {
    return <MarketFighterPanel embedded />;
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
  return <RunReportViewer embedded />;
}

function formatLaunchId(activeLaunchId: string): string {
  const match = activeLaunchId.match(/launch-(\d+)/);
  if (!match) return activeLaunchId;
  const date = new Date(Number(match[1]));
  if (Number.isNaN(date.getTime())) return activeLaunchId;
  return date.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
}

export default function MintConsoleShell({ initialTab = "Guide" }: { initialTab?: MainTab }) {
  const [activeTab, setActiveTab] = useState<MainTab>(initialTab);
  const [skin, setSkin] = useState<ConsoleSkin>("dark");
  const { wallets, scheduleReceipt, activeLaunchId } = usePlannerStore();

  const tabSummary = useMemo(() => tabCopy[activeTab].title, [activeTab]);
  const unlockedVaultWallets = useMemo(() => countUnlockedVaultWallets(wallets), [wallets]);
  const savedSchedules = scheduleReceipt ? 1 : 0;

  return (
    <CompasGate>
    <main className="compas-console overflow-x-hidden" data-skin={skin} data-active-tab={activeTab}>
      <div className={cx(
        "relative min-h-dvh bg-[var(--compas-bg-art)] px-3 pt-3 text-[color:var(--compas-ink)] transition-colors duration-300 sm:px-6 sm:pb-24 sm:pt-5 lg:px-8",
        activeTab === "Guide" ? "pb-6" : "pb-32",
      )}>
        <div className="pointer-events-none fixed inset-0 z-0 opacity-80 [background:var(--compas-grain)]" />
        <div className="relative z-10 mx-auto grid max-w-[1480px] min-w-0 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Sidebar active={activeTab} setActive={setActiveTab} stagedWallets={wallets.length} />
          <div className="grid min-w-0 gap-5">
            {activeTab === "Guide" ? (
              <MainPanel active={activeTab} setActive={setActiveTab} />
            ) : (
              <>
                <ReportStrip
                  stagedWallets={wallets.length}
                  savedSchedules={savedSchedules}
                  unlockedVaultWallets={unlockedVaultWallets}
                  skin={skin}
                  setSkin={setSkin}
                />
                <StatusRow activeLaunchId={activeLaunchId} />
                <OperatorFlow active={activeTab} setActive={setActiveTab} />
                <div className="rounded-[1.5rem] border border-[color:var(--compas-line)] bg-[color:var(--compas-soft)] px-4 py-3 text-sm font-bold text-[color:var(--compas-ink)] backdrop-blur">
                  Active module: <span className="font-black">{activeTab}</span> · {tabSummary}
                </div>
                <MainPanel active={activeTab} setActive={setActiveTab} />
              </>
            )}
          </div>
        </div>
      </div>
      <MobileBottomNav active={activeTab} setActive={setActiveTab} />
    </main>
    </CompasGate>
  );
}
