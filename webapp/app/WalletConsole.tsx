"use client";

import { FormEvent, useMemo, useState } from "react";
import { usePlannerStore } from "@/app/components/PlannerStoreProvider";
import {
  PLANNER_CHAINS,
  isPlannerAddress,
  parseBulkWalletImport,
  shortenWalletAddress,
  type PlannerWalletChain,
  type PlannerWalletDraft,
} from "@/lib/planner-store";

type WalletConsoleProps = {
  embedded?: boolean;
};

const CARD = "rounded-[1.5rem] border border-violet-100 bg-white/88 p-4 shadow-sm backdrop-blur-xl";
const FIELD = "rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm text-slate-950 outline-none shadow-sm placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100";

function containsPrivateKeyLike(value: string) {
  return /(?:^|[\s,\t])(?:0x)?[a-fA-F0-9]{64}(?=$|[\s,\t])/.test(value);
}

export default function WalletConsole({ embedded = false }: WalletConsoleProps) {
  const { wallets, walletCount, walletCapacity, addDemoWallets, addImportedWallets } = usePlannerStore();
  const [activeChain, setActiveChain] = useState<PlannerWalletChain | "All">("All");
  const [query, setQuery] = useState("");
  const [isImportOpen, setImportOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [bulkImportText, setBulkImportText] = useState("");
  const [draft, setDraft] = useState<PlannerWalletDraft>({
    name: "",
    address: "",
    chain: "ETH",
  });

  const visibleWallets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return wallets.filter((wallet) => {
      const matchesChain = activeChain === "All" || wallet.chain === activeChain;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        wallet.name.toLowerCase().includes(normalizedQuery) ||
        wallet.address.toLowerCase().includes(normalizedQuery) ||
        shortenWalletAddress(wallet.address).toLowerCase().includes(normalizedQuery);

      return matchesChain && matchesQuery;
    });
  }, [activeChain, query, wallets]);

  const chainCounts = useMemo(
    () =>
      PLANNER_CHAINS.reduce<Record<PlannerWalletChain, number>>(
        (counts, chain) => ({ ...counts, [chain]: wallets.filter((wallet) => wallet.chain === chain).length }),
        { ETH: 0, Base: 0 },
      ),
    [wallets],
  );

  function closeImportModal() {
    setImportOpen(false);
    setImportNotice("");
    setBulkImportText("");
  }

  function importWallets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const rawImport = bulkMode ? bulkImportText : draft.address;
    if (containsPrivateKeyLike(rawImport)) {
      setImportNotice("Private-key-shaped text detected. Secrets were cleared and not added to the planner store.");
      setBulkImportText("");
      setDraft((current) => ({ ...current, address: "" }));
      return;
    }

    const parsedWallets = bulkMode
      ? parseBulkWalletImport(bulkImportText, draft.chain)
      : isPlannerAddress(draft.address)
        ? [{ ...draft, name: draft.name.trim() || "Imported wallet" }]
        : [];

    if (parsedWallets.length === 0) {
      setImportNotice("No valid 0x wallet addresses found. Import public addresses only; private keys are not accepted or retained.");
      setBulkImportText("");
      return;
    }

    const importedCount = addImportedWallets(parsedWallets);
    setImportNotice(`${importedCount} wallet${importedCount === 1 ? "" : "s"} imported. Only public addresses entered the shared planner; secrets were discarded and never persisted.`);
    setDraft({ name: "", address: "", chain: draft.chain });
    setBulkImportText("");
  }

  return (
    <div className={`${embedded ? "rounded-[2rem] border border-violet-100 bg-white/82 shadow-sm" : "min-h-screen bg-[radial-gradient(circle_at_top_left,#ede9fe_0,#f8fafc_36%,#ffffff_72%)]"} text-slate-950`}>
      <section className={`mx-auto flex w-full max-w-7xl flex-col gap-6 ${embedded ? "px-0 py-0" : "px-4 py-6 sm:px-6 lg:px-8"}`}>
        <header className={`overflow-hidden rounded-[2rem] border border-violet-100 bg-white/88 p-6 ${embedded ? "" : "shadow-sm backdrop-blur-xl sm:p-8"}`}>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-violet-700">
                <span className="rounded-full border border-violet-100 bg-violet-50 px-3 py-1">Compas Mint Kit</span>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">Shared planner</span>
              </div>
              <div className="space-y-3">
                <h1 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">Wallets</h1>
                <p className="max-w-2xl text-sm font-semibold leading-6 text-slate-500 sm:text-base">
                  Create demo wallets, review imported masked public addresses, and feed the Mints schedule count from one client-side planner store. Private keys are not accepted.
                </p>
              </div>
            </div>

            <div className="grid gap-3 rounded-3xl border border-violet-100 bg-violet-50/65 p-4 text-sm font-semibold text-slate-600 sm:min-w-72 sm:grid-cols-3 lg:grid-cols-1">
              <MetricMini label="Wallet count" value={walletCapacity} />
              <MetricMini label="Mints using" value={`${walletCount} selected`} />
              <MetricMini label="Private keys" value="Not accepted" accent />
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div className={CARD}>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2">
                {(["All", ...PLANNER_CHAINS] as const).map((chain) => (
                  <button
                    key={chain}
                    type="button"
                    onClick={() => setActiveChain(chain)}
                    className={`rounded-full border px-4 py-2 text-sm font-black transition ${
                      activeChain === chain
                        ? "border-violet-600 bg-violet-600 text-white shadow-sm"
                        : "border-violet-100 bg-white text-slate-600 hover:border-violet-200 hover:text-violet-700"
                    }`}
                  >
                    <span aria-hidden="true">{chain === "Base" ? "🔵" : chain === "ETH" ? "◆" : "◌"}</span> {chain}
                    <span className="ml-2 text-xs opacity-70">{chain === "All" ? wallets.length : chainCounts[chain]}</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="relative block sm:w-72">
                  <span className="sr-only">Search wallets</span>
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name or masked address"
                    className="h-11 w-full rounded-full border border-violet-100 bg-white pl-10 pr-4 text-sm font-semibold text-slate-950 outline-none shadow-sm transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                  />
                </label>
                <button
                  type="button"
                  onClick={addDemoWallets}
                  className="h-11 rounded-full border border-violet-100 bg-white px-5 text-sm font-black text-violet-700 shadow-sm transition hover:border-violet-200"
                >
                  Create demo
                </button>
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="h-11 rounded-full bg-violet-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-violet-500"
                >
                  Import
                </button>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-violet-100 bg-white">
              <div className="grid grid-cols-[1.2fr_1.5fr_0.7fr_0.8fr] gap-4 border-b border-violet-100 bg-violet-50/60 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-400 max-md:hidden">
                <span>Name</span>
                <span>Masked address</span>
                <span>Chain</span>
                <span>Balance</span>
              </div>

              <div className="divide-y divide-violet-100">
                {visibleWallets.map((wallet) => (
                  <article key={wallet.id} className="grid gap-3 px-4 py-4 text-sm transition hover:bg-violet-50/40 md:grid-cols-[1.2fr_1.5fr_0.7fr_0.8fr] md:items-center">
                    <div>
                      <p className="font-black text-slate-950">{wallet.name}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">{wallet.source === "demo" ? "Generated demo" : "Imported public address"}</p>
                    </div>
                    <div className="font-mono text-xs font-semibold text-slate-600 sm:text-sm" title={shortenWalletAddress(wallet.address)}>
                      {shortenWalletAddress(wallet.address)}
                    </div>
                    <div>
                      <span className="inline-flex items-center rounded-full border border-violet-100 bg-violet-50 px-3 py-1 text-xs font-black text-violet-700">
                        <span className="mr-1" aria-hidden="true">{wallet.chain === "Base" ? "🔵" : "◆"}</span>
                        {wallet.chain}
                      </span>
                    </div>
                    <div className="font-semibold text-slate-600">{wallet.balance}</div>
                  </article>
                ))}

                {visibleWallets.length === 0 ? (
                  <div className="px-4 py-12 text-center text-sm font-semibold text-slate-400">No wallets match this search or chain filter.</div>
                ) : null}
              </div>
            </div>
          </div>

          <aside className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Safety first</p>
            <h2 className="mt-3 text-xl font-black text-slate-950">No custody. No saved secrets.</h2>
            <ul className="mt-4 space-y-3">
              <li>• Demo wallets use random public addresses only.</li>
              <li>• Imports store address, label, and chain only.</li>
              <li>• Private-key-shaped text is rejected and cleared.</li>
              <li>• Mints reads this table for wallet wave counts.</li>
            </ul>
          </aside>
        </section>
      </section>

      {isImportOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <form onSubmit={importWallets} className="max-h-full w-full max-w-3xl overflow-y-auto rounded-[1.75rem] border border-violet-100 bg-white p-5 shadow-2xl shadow-violet-950/20 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-600">Import wallets</p>
                <h2 id="import-title" className="mt-2 text-2xl font-black text-slate-950">Address-only import parser</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">Paste public wallet addresses only. Private-key-shaped text is rejected and cleared before anything enters the shared planner.</p>
              </div>
              <button type="button" onClick={closeImportModal} className="rounded-full border border-violet-100 bg-white px-3 py-1 text-sm font-black text-slate-600 hover:text-violet-700">Close</button>
            </div>

            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              <strong>Warning:</strong> local session only / never paste funded keys. If private-key-shaped text is detected, the input is rejected and cleared.
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-violet-50/60 p-3">
              <div>
                <p className="font-black text-slate-950">Bulk import</p>
                <p className="text-xs font-semibold text-slate-500">Paste one wallet per line: optional name, public 0x address. Do not include private keys.</p>
              </div>
              <button
                type="button"
                onClick={() => setBulkMode((enabled) => !enabled)}
                className={`rounded-full px-4 py-2 text-sm font-black transition ${bulkMode ? "bg-violet-600 text-white" : "bg-white text-violet-700 hover:bg-violet-50"}`}
                aria-pressed={bulkMode}
              >
                {bulkMode ? "Bulk on" : "Bulk off"}
              </button>
            </div>

            {bulkMode ? (
              <label className="mt-5 block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Name / address</span>
                <textarea
                  value={bulkImportText}
                  onChange={(event) => setBulkImportText(event.target.value)}
                  rows={8}
                  placeholder="Mint ops, 0x0000000000000000000000000000000000000000\nBase review, 0x1111111111111111111111111111111111111111"
                  className={`${FIELD} mt-2 w-full font-mono`}
                />
              </label>
            ) : (
              <div className="mt-5 overflow-hidden rounded-2xl border border-violet-100">
                <div className="grid gap-3 border-b border-violet-100 bg-violet-50/60 p-3 text-xs font-black uppercase tracking-[0.16em] text-slate-400 md:grid-cols-[1fr_1.4fr_0.6fr]">
                  <span>Name</span>
                  <span>Address</span>
                  <span>Chain</span>
                </div>
                <div className="grid gap-3 p-3 md:grid-cols-[1fr_1.4fr_0.6fr]">
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Mint ops"
                    className={FIELD}
                  />
                  <input
                    value={draft.address}
                    onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value.trim() }))}
                    placeholder="0x..."
                    className={`${FIELD} font-mono`}
                  />
                  <select
                    value={draft.chain}
                    onChange={(event) => setDraft((current) => ({ ...current, chain: event.target.value as PlannerWalletChain }))}
                    className={FIELD}
                  >
                    {PLANNER_CHAINS.map((chain) => (
                      <option key={chain} value={chain}>{chain}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-semibold text-slate-500">Address import updates shared in-memory state only. Private key text is never saved.</p>
              <button type="submit" className="rounded-full bg-violet-600 px-5 py-3 text-sm font-black text-white transition hover:bg-violet-500">Import wallet</button>
            </div>

            {importNotice ? <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{importNotice}</p> : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}

function MetricMini({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className={`mt-1 font-black ${accent ? "text-emerald-700" : "text-slate-950"}`}>{value}</p>
    </div>
  );
}
