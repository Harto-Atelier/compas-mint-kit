"use client";

import { FormEvent, useMemo, useRef, useState } from "react";

type Chain = "ETH" | "Base";
type WalletSource = "demo" | "imported";

type WalletRecord = {
  id: string;
  name: string;
  address: string;
  chain: Chain;
  balance: string;
  source: WalletSource;
  secretStatus: "none" | "discarded";
  createdAt: number;
};

type DraftImport = {
  name: string;
  address: string;
  chain: Chain;
};

const CHAINS: Chain[] = ["ETH", "Base"];

const seedWallets: WalletRecord[] = [
  {
    id: "seed-eth-ops",
    name: "Mint ops demo",
    address: "0x7E57f9dC2B63aC108F0E47aE0D51f5130A8a12B4",
    chain: "ETH",
    balance: "0.42 ETH demo",
    source: "demo",
    secretStatus: "none",
    createdAt: 1,
  },
  {
    id: "seed-base-review",
    name: "Base review demo",
    address: "0xbA5E3f1D210F6F4318731D1dE7f4D91A8A9b00C0",
    chain: "Base",
    balance: "1.80 ETH demo",
    source: "demo",
    secretStatus: "none",
    createdAt: 2,
  },
];

function randomHex(bytes: number) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeDemoWallet(count: number): WalletRecord {
  const chain = count % 2 === 0 ? "ETH" : "Base";
  const safeDemoBalance = chain === "ETH" ? "0.00 ETH demo" : "0.05 ETH demo";

  return {
    id: `demo-${Date.now()}-${count}`,
    name: `Demo wallet ${count + 1}`,
    address: `0x${randomHex(20)}`,
    chain,
    balance: safeDemoBalance,
    source: "demo",
    secretStatus: "none",
    createdAt: Date.now(),
  };
}

function isAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function parseBulkImport(raw: string, fallbackChain: Chain): DraftImport[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split(/[\t,]/).map((part) => part.trim()).filter(Boolean);
      const addressIndex = parts.findIndex((part) => isAddress(part));
      const address = addressIndex >= 0 ? parts[addressIndex] : "";
      const name = addressIndex > 0 ? parts.slice(0, addressIndex).join(" ") : `Imported wallet ${index + 1}`;

      return {
        name: name || `Imported wallet ${index + 1}`,
        address,
        chain: fallbackChain,
      };
    })
    .filter((wallet) => isAddress(wallet.address));
}

export default function WalletConsole() {
  const [wallets, setWallets] = useState<WalletRecord[]>(seedWallets);
  const [activeChain, setActiveChain] = useState<Chain | "All">("All");
  const [query, setQuery] = useState("");
  const [isImportOpen, setImportOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [draft, setDraft] = useState<DraftImport>({
    name: "",
    address: "",
    chain: "ETH",
  });
  const singleSecretRef = useRef<HTMLInputElement>(null);
  const bulkSecretRef = useRef<HTMLTextAreaElement>(null);

  const visibleWallets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return wallets.filter((wallet) => {
      const matchesChain = activeChain === "All" || wallet.chain === activeChain;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        wallet.name.toLowerCase().includes(normalizedQuery) ||
        wallet.address.toLowerCase().includes(normalizedQuery);

      return matchesChain && matchesQuery;
    });
  }, [activeChain, query, wallets]);

  const chainCounts = useMemo(
    () =>
      CHAINS.reduce<Record<Chain, number>>(
        (counts, chain) => ({ ...counts, [chain]: wallets.filter((wallet) => wallet.chain === chain).length }),
        { ETH: 0, Base: 0 },
      ),
    [wallets],
  );

  function createDemoWallets() {
    setWallets((current) => {
      const first = makeDemoWallet(current.length);
      const second = makeDemoWallet(current.length + 1);
      return [first, second, ...current];
    });
  }

  function closeImportModal() {
    setImportOpen(false);
    setImportNotice("");
    if (singleSecretRef.current) {
      singleSecretRef.current.value = "";
    }
    if (bulkSecretRef.current) {
      bulkSecretRef.current.value = "";
    }
  }

  function importWallets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedWallets = bulkMode
      ? parseBulkImport(bulkSecretRef.current?.value ?? "", draft.chain)
      : isAddress(draft.address)
        ? [{ ...draft, name: draft.name.trim() || "Imported wallet" }]
        : [];

    if (parsedWallets.length === 0) {
      setImportNotice("No valid 0x wallet addresses found. Secrets were not retained.");
      if (singleSecretRef.current) {
        singleSecretRef.current.value = "";
      }
      if (bulkSecretRef.current) {
        bulkSecretRef.current.value = "";
      }
      return;
    }

    const imported = parsedWallets.map<WalletRecord>((wallet, index) => ({
      id: `import-${Date.now()}-${index}`,
      name: wallet.name,
      address: wallet.address,
      chain: wallet.chain,
      balance: "Not connected",
      source: "imported",
      secretStatus: "discarded",
      createdAt: Date.now() + index,
    }));

    setWallets((current) => [...imported, ...current]);
    setImportNotice(`${imported.length} wallet${imported.length === 1 ? "" : "s"} imported. Private key text was masked, discarded, and never persisted.`);
    setDraft({ name: "", address: "", chain: draft.chain });
    if (singleSecretRef.current) {
      singleSecretRef.current.value = "";
    }
    if (bulkSecretRef.current) {
      bulkSecretRef.current.value = "";
    }
  }

  return (
    <main className="min-h-screen bg-[#070707] text-zinc-50">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-zinc-950 via-black to-zinc-900 p-6 shadow-2xl shadow-orange-950/20 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-orange-300">
                <span className="rounded-full border border-orange-400/30 bg-orange-400/10 px-3 py-1">Compas Mint Kit</span>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-emerald-200">Local session only</span>
              </div>
              <div className="space-y-3">
                <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">Wallets</h1>
                <p className="max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
                  Create demo wallets, review imported addresses, and keep launch operations separated by chain. This UI never stores private keys — local session only / never paste funded keys.
                </p>
              </div>
            </div>

            <div className="grid gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-300 sm:min-w-72 sm:grid-cols-3 lg:grid-cols-1">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Wallet count</p>
                <p className="mt-1 text-3xl font-semibold text-white">{wallets.length}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Private keys</p>
                <p className="mt-1 font-medium text-emerald-200">Never persisted</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Mode</p>
                <p className="mt-1 font-medium text-orange-200">Safe demo store</p>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div className="rounded-[1.5rem] border border-white/10 bg-zinc-950/80 p-4 shadow-xl shadow-black/30">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-2">
                {(["All", ...CHAINS] as const).map((chain) => (
                  <button
                    key={chain}
                    type="button"
                    onClick={() => setActiveChain(chain)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                      activeChain === chain
                        ? "border-orange-300 bg-orange-300 text-black"
                        : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-orange-300/60 hover:text-white"
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
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">⌕</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name or address"
                    className="h-11 w-full rounded-full border border-white/10 bg-black/50 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-orange-300/70"
                  />
                </label>
                <button
                  type="button"
                  onClick={createDemoWallets}
                  className="h-11 rounded-full border border-white/10 bg-white px-5 text-sm font-semibold text-black transition hover:bg-zinc-200"
                >
                  Create demo
                </button>
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="h-11 rounded-full bg-orange-400 px-5 text-sm font-semibold text-black transition hover:bg-orange-300"
                >
                  Import
                </button>
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
              <div className="grid grid-cols-[1.2fr_1.5fr_0.7fr_0.8fr] gap-4 border-b border-white/10 bg-white/[0.04] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 max-md:hidden">
                <span>Name</span>
                <span>Address</span>
                <span>Chain</span>
                <span>Balance</span>
              </div>

              <div className="divide-y divide-white/10">
                {visibleWallets.map((wallet) => (
                  <article key={wallet.id} className="grid gap-3 px-4 py-4 text-sm transition hover:bg-white/[0.03] md:grid-cols-[1.2fr_1.5fr_0.7fr_0.8fr] md:items-center">
                    <div>
                      <p className="font-medium text-white">{wallet.name}</p>
                      <p className="mt-1 text-xs text-zinc-500">{wallet.source === "demo" ? "Generated demo" : "Imported · secret discarded"}</p>
                    </div>
                    <div className="font-mono text-xs text-zinc-300 sm:text-sm">
                      <span className="hidden sm:inline">{wallet.address}</span>
                      <span className="sm:hidden">{shortenAddress(wallet.address)}</span>
                    </div>
                    <div>
                      <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-zinc-200">
                        <span className="mr-1" aria-hidden="true">{wallet.chain === "Base" ? "🔵" : "◆"}</span>
                        {wallet.chain}
                      </span>
                    </div>
                    <div className="text-zinc-300">{wallet.balance}</div>
                  </article>
                ))}

                {visibleWallets.length === 0 ? (
                  <div className="px-4 py-12 text-center text-sm text-zinc-500">No wallets match this search or chain filter.</div>
                ) : null}
              </div>
            </div>
          </div>

          <aside className="rounded-[1.5rem] border border-orange-300/20 bg-orange-300/[0.08] p-5 text-sm text-orange-50">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-200">Safety first</p>
            <h2 className="mt-3 text-xl font-semibold text-white">No custody. No saved secrets.</h2>
            <ul className="mt-4 space-y-3 text-orange-100/80">
              <li>• Demo wallets use random addresses only.</li>
              <li>• Import parsing runs in this browser session.</li>
              <li>• Private key input is cleared after import.</li>
              <li>• Never paste funded keys into this console.</li>
            </ul>
          </aside>
        </section>
      </section>

      {isImportOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <form onSubmit={importWallets} className="max-h-full w-full max-w-3xl overflow-y-auto rounded-[1.75rem] border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-300">Import wallets</p>
                <h2 id="import-title" className="mt-2 text-2xl font-semibold text-white">Client-only import parser</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">Secrets are accepted only long enough to derive the visible row. They are masked, cleared, and not saved.</p>
              </div>
              <button type="button" onClick={closeImportModal} className="rounded-full border border-white/10 px-3 py-1 text-sm text-zinc-300 hover:text-white">Close</button>
            </div>

            <div className="mt-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-100">
              <strong>Warning:</strong> local session only / never paste funded keys. This demo does not encrypt, upload, persist, or recover private keys.
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div>
                <p className="font-medium text-white">Bulk import</p>
                <p className="text-xs text-zinc-500">Paste one wallet per line: name, address, private key.</p>
              </div>
              <button
                type="button"
                onClick={() => setBulkMode((enabled) => !enabled)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${bulkMode ? "bg-orange-400 text-black" : "bg-white/10 text-zinc-200 hover:bg-white/15"}`}
                aria-pressed={bulkMode}
              >
                {bulkMode ? "Bulk on" : "Bulk off"}
              </button>
            </div>

            {bulkMode ? (
              <label className="mt-5 block">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Name / address / private key</span>
                <textarea
                  ref={bulkSecretRef}
                  rows={8}
                  placeholder="Mint ops, 0x0000000000000000000000000000000000000000, 0x...\nBase review, 0x1111111111111111111111111111111111111111, 0x..."
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/50 p-4 font-mono text-sm text-white outline-none placeholder:text-zinc-700 focus:border-orange-300/70"
                />
              </label>
            ) : (
              <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
                <div className="grid gap-3 border-b border-white/10 bg-white/[0.04] p-3 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 md:grid-cols-[1fr_1.4fr_1.1fr_0.6fr]">
                  <span>Name</span>
                  <span>Address</span>
                  <span>Private key</span>
                  <span>Chain</span>
                </div>
                <div className="grid gap-3 p-3 md:grid-cols-[1fr_1.4fr_1.1fr_0.6fr]">
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Mint ops"
                    className="rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-orange-300/70"
                  />
                  <input
                    value={draft.address}
                    onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value.trim() }))}
                    placeholder="0x..."
                    className="rounded-xl border border-white/10 bg-black/50 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-zinc-700 focus:border-orange-300/70"
                  />
                  <input
                    ref={singleSecretRef}
                    type="password"
                    autoComplete="off"
                    placeholder="masked then discarded"
                    className="rounded-xl border border-red-400/20 bg-black/50 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-700 focus:border-red-300/70"
                  />
                  <select
                    value={draft.chain}
                    onChange={(event) => setDraft((current) => ({ ...current, chain: event.target.value as Chain }))}
                    className="rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-orange-300/70"
                  >
                    {CHAINS.map((chain) => (
                      <option key={chain} value={chain}>{chain}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-zinc-500">Private key column displays as •••••••• after import. No secret bytes are added to the wallet store.</p>
              <button type="submit" className="rounded-full bg-orange-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-orange-300">Import wallet</button>
            </div>

            {importNotice ? <p className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-100">{importNotice}</p> : null}
          </form>
        </div>
      ) : null}
    </main>
  );
}
