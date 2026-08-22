"use client";

import { FormEvent, useMemo, useState } from "react";
import { usePlannerStore } from "@/app/components/PlannerStoreProvider";
import { createEncryptedVaultWallet } from "@/lib/browser-vault";
import {
  PLANNER_CHAINS,
  isPlannerAddress,
  parseBulkWalletImport,
  shortenWalletAddress,
  type PlannerWalletChain,
  type PlannerWalletDraft,
  type RotatePreviousVaultMode,
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
  const {
    wallets,
    walletCount,
    walletCapacity,
    activeLaunchId,
    activeLaunchVault,
    launchVaults,
    addDemoWallets,
    addImportedWallets,
    addEncryptedVaultWallet,
    unlockVaultWallet,
    rotateForNewLaunch,
    wipeOldLaunchKeys,
  } = usePlannerStore();
  const [activeChain, setActiveChain] = useState<PlannerWalletChain | "All">("All");
  const [query, setQuery] = useState("");
  const [isImportOpen, setImportOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [rotationMode, setRotationMode] = useState<RotatePreviousVaultMode>("archive");
  const [launchNotice, setLaunchNotice] = useState("");
  const [wipeLaunchId, setWipeLaunchId] = useState<string | null>(null);
  const [wipeConfirmation, setWipeConfirmation] = useState("");
  const [wipeError, setWipeError] = useState("");
  const [bulkImportText, setBulkImportText] = useState("");
  const [vaultMode, setVaultMode] = useState(false);
  const [vaultPrivateKey, setVaultPrivateKey] = useState("");
  const [vaultPassphrase, setVaultPassphrase] = useState("");
  const [vaultPassphraseConfirm, setVaultPassphraseConfirm] = useState("");
  const [vaultBusy, setVaultBusy] = useState(false);
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

  const oldLaunchVaults = useMemo(
    () => launchVaults.filter((vault) => vault.launchId !== activeLaunchId),
    [activeLaunchId, launchVaults],
  );

  function rotateLaunch() {
    const nextVault = rotateForNewLaunch(rotationMode);
    setQuery("");
    setLaunchNotice(
      `Rotated into ${nextVault.launchId}. Previous launch was ${rotationMode === "archive" ? "archived for manual wipe" : "deleted immediately"}; the new vault is empty and encrypted.`,
    );
  }

  function openWipeModal(launchId: string) {
    setWipeLaunchId(launchId);
    setWipeConfirmation("");
    setWipeError("");
  }

  function confirmWipe() {
    if (!wipeLaunchId) return;
    try {
      wipeOldLaunchKeys(wipeLaunchId, wipeConfirmation);
      setLaunchNotice(`Wiped encrypted key metadata for ${wipeLaunchId}.`);
      setWipeLaunchId(null);
      setWipeConfirmation("");
      setWipeError("");
    } catch (err) {
      setWipeError(err instanceof Error ? err.message : String(err));
    }
  }

  function closeImportModal() {
    setImportOpen(false);
    setImportNotice("");
    setBulkImportText("");
    setVaultPrivateKey("");
    setVaultPassphrase("");
    setVaultPassphraseConfirm("");
  }

  async function importWallets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (vaultMode) {
      if (vaultPassphrase !== vaultPassphraseConfirm) {
        setImportNotice("Vault passphrases do not match. No encrypted wallet was saved.");
        return;
      }
      setVaultBusy(true);
      try {
        const encryptedVault = await createEncryptedVaultWallet({ privateKey: vaultPrivateKey, passphrase: vaultPassphrase });
        const record = addEncryptedVaultWallet({ name: draft.name, chain: draft.chain, encryptedVault });
        setImportNotice(`${record.name} added as an encrypted browser vault wallet (${shortenWalletAddress(record.address)}). Unlock only in a trusted local build before browser execution.`);
        setDraft({ name: "", address: "", chain: draft.chain });
        setVaultPrivateKey("");
        setVaultPassphrase("");
        setVaultPassphraseConfirm("");
      } catch (err) {
        setImportNotice(err instanceof Error ? err.message : String(err));
      } finally {
        setVaultBusy(false);
      }
      return;
    }

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

  async function unlockWallet(walletId: string) {
    const passphrase = window.prompt("Unlock encrypted vault wallet for this browser tab only. Use this only in a trusted local build, never on an untrusted hosted app.");
    if (!passphrase) return;
    try {
      const wallet = await unlockVaultWallet(walletId, passphrase);
      setImportNotice(`${wallet.name} unlocked in memory for encrypted browser execution. No key was sent to the server.`);
    } catch (err) {
      setImportNotice(err instanceof Error ? err.message : String(err));
    }
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

        <section className="rounded-[1.5rem] border border-violet-100 bg-white/88 p-4 shadow-sm backdrop-blur-xl">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-600">Per-launch key rotation</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">Active launch vault</h2>
              <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600 md:grid-cols-3">
                <VaultFact label="Launch ID" value={activeLaunchVault.launchId} />
                <VaultFact label="Vault ID" value={activeLaunchVault.vaultId} />
                <VaultFact label="Created" value={new Date(activeLaunchVault.createdAt).toLocaleString()} />
              </div>
              {activeLaunchVault.rotatedFrom ? (
                <p className="mt-3 text-xs font-bold text-slate-500">Rotated from {activeLaunchVault.rotatedFrom}. This launch starts with an empty encrypted vault; no plaintext keys are persisted.</p>
              ) : null}
              {launchNotice ? <p className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{launchNotice}</p> : null}
            </div>

            <div className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-600 sm:min-w-80">
              <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                Previous launch handling
                <select
                  value={rotationMode}
                  onChange={(event) => setRotationMode(event.target.value as RotatePreviousVaultMode)}
                  className={FIELD}
                >
                  <option value="archive">Archive previous for later wipe</option>
                  <option value="delete">Delete previous immediately</option>
                </select>
              </label>
              <button type="button" onClick={rotateLaunch} className="rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-violet-700">
                Rotate for new launch
              </button>
              <p className="text-xs font-semibold leading-5 text-slate-500">Rotation clears the active wallet list and creates a new launchId/vaultId pair backed by an empty encrypted-vault envelope.</p>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-violet-100">
            <div className="grid gap-3 border-b border-violet-100 bg-violet-50/60 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-400 md:grid-cols-[1fr_1fr_0.6fr_0.7fr_0.7fr]">
              <span>Old launch</span>
              <span>Vault</span>
              <span>Status</span>
              <span>Wallets</span>
              <span>Action</span>
            </div>
            {oldLaunchVaults.length > 0 ? oldLaunchVaults.map((vault) => (
              <div key={vault.launchId} className="grid gap-3 px-4 py-3 text-sm font-semibold text-slate-600 md:grid-cols-[1fr_1fr_0.6fr_0.7fr_0.7fr] md:items-center">
                <span className="truncate font-mono text-xs" title={vault.launchId}>{vault.launchId}</span>
                <span className="truncate font-mono text-xs" title={vault.vaultId}>{vault.vaultId}</span>
                <span className="capitalize">{vault.status}</span>
                <span>{vault.walletCount}</span>
                <button
                  type="button"
                  onClick={() => openWipeModal(vault.launchId)}
                  disabled={vault.status !== "archived"}
                  className="rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  Wipe old launch keys
                </button>
              </div>
            )) : (
              <div className="px-4 py-5 text-sm font-semibold text-slate-400">No archived launch vaults yet. Rotate with archive mode to make a previous launch wipeable.</div>
            )}
          </div>
        </section>

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
                      <p className="mt-1 text-xs font-semibold text-slate-400">
                        {wallet.source === "demo" ? "Generated demo" : wallet.source === "vault" ? `Encrypted vault · ${wallet.secretStatus}` : "Imported public address"}
                      </p>
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
                    <div className="font-semibold text-slate-600">
                      <p>{wallet.balance}</p>
                      {wallet.source === "vault" ? (
                        <button
                          type="button"
                          onClick={() => unlockWallet(wallet.id)}
                          disabled={wallet.secretStatus === "unlocked"}
                          className="mt-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-black text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {wallet.secretStatus === "unlocked" ? "Unlocked in tab" : "Unlock local"}
                        </button>
                      ) : null}
                    </div>
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
                <h2 id="import-title" className="mt-2 text-2xl font-black text-slate-950">Address-only or encrypted vault import</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">Address mode stores public addresses only. Vault mode seals one private key into AES-GCM ciphertext and stores only the derived public address in the planner.</p>
              </div>
              <button type="button" onClick={closeImportModal} className="rounded-full border border-violet-100 bg-white px-3 py-1 text-sm font-black text-slate-600 hover:text-violet-700">Close</button>
            </div>

            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              <strong>Warning:</strong> only use encrypted vault import in a trusted local browser session. Plain address import rejects and clears private-key-shaped text.
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-violet-50/60 p-3">
              <div>
                <p className="font-black text-slate-950">Import mode</p>
                <p className="text-xs font-semibold text-slate-500">Bulk import is address-only. Encrypted vault mode accepts one key and immediately clears it after sealing.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setBulkMode((enabled) => !enabled)} disabled={vaultMode} className={`rounded-full px-4 py-2 text-sm font-black transition ${bulkMode ? "bg-violet-600 text-white" : "bg-white text-violet-700 hover:bg-violet-50"} disabled:cursor-not-allowed disabled:opacity-50`} aria-pressed={bulkMode}>
                  {bulkMode ? "Bulk on" : "Bulk off"}
                </button>
                <button type="button" onClick={() => setVaultMode((enabled) => !enabled)} className={`rounded-full px-4 py-2 text-sm font-black transition ${vaultMode ? "bg-amber-500 text-white" : "bg-white text-amber-700 hover:bg-amber-50"}`} aria-pressed={vaultMode}>
                  {vaultMode ? "Vault on" : "Encrypted vault"}
                </button>
              </div>
            </div>

            {vaultMode ? (
              <div className="mt-5 grid gap-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-3 md:grid-cols-[1fr_0.6fr]">
                <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Wallet label" className={FIELD} />
                <select value={draft.chain} onChange={(event) => setDraft((current) => ({ ...current, chain: event.target.value as PlannerWalletChain }))} className={FIELD}>
                  {PLANNER_CHAINS.map((chain) => <option key={chain} value={chain}>{chain}</option>)}
                </select>
                <textarea value={vaultPrivateKey} onChange={(event) => setVaultPrivateKey(event.target.value)} rows={3} placeholder="0x private key — sealed locally, then cleared" className={`${FIELD} h-auto font-mono md:col-span-2`} />
                <input value={vaultPassphrase} onChange={(event) => setVaultPassphrase(event.target.value)} type="password" minLength={12} autoComplete="new-password" placeholder="Vault passphrase (12+ chars)" className={FIELD} />
                <input value={vaultPassphraseConfirm} onChange={(event) => setVaultPassphraseConfirm(event.target.value)} type="password" minLength={12} autoComplete="new-password" placeholder="Confirm passphrase" className={FIELD} />
              </div>
            ) : bulkMode ? (
              <label className="mt-5 block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Name / address</span>
                <textarea value={bulkImportText} onChange={(event) => setBulkImportText(event.target.value)} rows={8} placeholder="Mint ops, 0x0000000000000000000000000000000000000000\nBase review, 0x1111111111111111111111111111111111111111" className={`${FIELD} mt-2 h-auto w-full font-mono`} />
              </label>
            ) : (
              <div className="mt-5 overflow-hidden rounded-2xl border border-violet-100">
                <div className="grid gap-3 border-b border-violet-100 bg-violet-50/60 p-3 text-xs font-black uppercase tracking-[0.16em] text-slate-400 md:grid-cols-[1fr_1.4fr_0.6fr]">
                  <span>Name</span>
                  <span>Address</span>
                  <span>Chain</span>
                </div>
                <div className="grid gap-3 p-3 md:grid-cols-[1fr_1.4fr_0.6fr]">
                  <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Mint ops" className={FIELD} />
                  <input value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value.trim() }))} placeholder="0x..." className={`${FIELD} font-mono`} />
                  <select value={draft.chain} onChange={(event) => setDraft((current) => ({ ...current, chain: event.target.value as PlannerWalletChain }))} className={FIELD}>
                    {PLANNER_CHAINS.map((chain) => <option key={chain} value={chain}>{chain}</option>)}
                  </select>
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-semibold text-slate-500">{vaultMode ? "Encrypted vault import stores ciphertext and public address locally. Do not use this on untrusted hosted apps." : "Address import updates shared in-memory state only. Private key text is never saved."}</p>
              <button type="submit" disabled={vaultBusy} className="rounded-full bg-violet-600 px-5 py-3 text-sm font-black text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60">{vaultBusy ? "Encrypting…" : vaultMode ? "Encrypt vault wallet" : "Import wallet"}</button>
            </div>

            {importNotice ? <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{importNotice}</p> : null}
          </form>
        </div>
      ) : null}

      {wipeLaunchId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="wipe-title">
          <div className="w-full max-w-xl rounded-[1.75rem] border border-red-200 bg-white p-5 shadow-2xl shadow-red-950/20 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-red-600">Confirm wipe</p>
                <h2 id="wipe-title" className="mt-2 text-2xl font-black text-slate-950">Wipe old launch keys</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">Type the launch ID exactly to destroy archived encrypted-vault metadata. This never exposes plaintext keys.</p>
              </div>
              <button type="button" onClick={() => setWipeLaunchId(null)} className="rounded-full border border-violet-100 bg-white px-3 py-1 text-sm font-black text-slate-600 hover:text-violet-700">Close</button>
            </div>
            <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-3 font-mono text-xs font-bold text-red-700">{wipeLaunchId}</p>
            <label className="mt-4 block text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              Type launch ID
              <input value={wipeConfirmation} onChange={(event) => setWipeConfirmation(event.target.value)} className={`${FIELD} mt-2 w-full font-mono normal-case tracking-normal`} />
            </label>
            {wipeError ? <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{wipeError}</p> : null}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setWipeLaunchId(null)} className="rounded-full border border-violet-100 bg-white px-5 py-3 text-sm font-black text-slate-600">Cancel</button>
              <button type="button" onClick={confirmWipe} className="rounded-full bg-red-600 px-5 py-3 text-sm font-black text-white transition hover:bg-red-500">Confirm wipe</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VaultFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-violet-500">{label}</p>
      <p className="mt-1 truncate font-mono text-xs font-bold text-slate-700" title={value}>{value}</p>
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
