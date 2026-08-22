"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  LAUNCH_VAULT_STORAGE_KEY,
  createLaunchVaultPayload,
  decryptLaunchVaultBackup,
  deriveWalletFromPrivateKey,
  encryptLaunchVaultPayload,
  formatVaultTimestamp,
  maskVaultAddress,
  mergeVaultWallets,
  parseEncryptedLaunchVaultBackup,
  parsePrivateKeyBulkImport,
  serializeEncryptedLaunchVaultBackup,
  slugifyLaunchId,
  toPublicLaunchWallet,
  type EncryptedLaunchVaultBackup,
  type LaunchVaultChain,
  type LaunchVaultPayload,
} from "@/lib/encrypted-launch-vault";

const FIELD =
  "h-12 rounded-2xl border border-violet-100 bg-white/90 px-4 text-sm font-bold text-slate-950 outline-none shadow-sm transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100";
const TEXTAREA =
  "rounded-2xl border border-violet-100 bg-white/90 px-4 py-3 text-sm font-bold text-slate-950 outline-none shadow-sm transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100";
const CARD = "rounded-[2rem] border border-violet-100 bg-white/90 p-5 shadow-sm backdrop-blur";
const CHAINS: LaunchVaultChain[] = ["ETH", "Base"];

export default function LaunchVaultConsole({ embedded = false }: { embedded?: boolean }) {
  const [encryptedBackup, setEncryptedBackup] = useState<EncryptedLaunchVaultBackup | null>(null);
  const [vault, setVault] = useState<LaunchVaultPayload | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [createLaunchName, setCreateLaunchName] = useState("Compas launch");
  const [createLaunchId, setCreateLaunchId] = useState("compas-launch");
  const [createPassphrase, setCreatePassphrase] = useState("");
  const [createConfirm, setCreateConfirm] = useState("");

  const [unlockPassphrase, setUnlockPassphrase] = useState("");

  const [walletLabel, setWalletLabel] = useState("Launch wallet");
  const [walletChain, setWalletChain] = useState<LaunchVaultChain>("ETH");
  const [bulkMode, setBulkMode] = useState(false);
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [sealPassphrase, setSealPassphrase] = useState("");

  const [wipePhrase, setWipePhrase] = useState("");

  useEffect(() => {
    setStorageReady(true);
    try {
      const raw = window.localStorage.getItem(LAUNCH_VAULT_STORAGE_KEY);
      if (!raw) return;
      setEncryptedBackup(parseEncryptedLaunchVaultBackup(raw));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stored launch vault could not be read.");
    }
  }, []);

  const publicWallets = useMemo(() => vault?.wallets.map(toPublicLaunchWallet) ?? [], [vault]);
  const encryptedSize = useMemo(() => {
    if (!encryptedBackup) return "0 KB";
    const bytes = new Blob([serializeEncryptedLaunchVaultBackup(encryptedBackup)]).size;
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  }, [encryptedBackup]);
  const wipeConfirmation = vault ? `WIPE ${vault.launchId}` : "WIPE VAULT";

  async function handleCreateVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();

    if (encryptedBackup) {
      setError("A launch vault already exists in this browser. Export or wipe it before creating a new one.");
      return;
    }
    if (createPassphrase !== createConfirm) {
      setError("Passphrase confirmation does not match.");
      return;
    }

    setBusy("Creating encrypted vault…");
    try {
      const now = Date.now();
      const payload = createLaunchVaultPayload({
        launchName: createLaunchName,
        launchId: createLaunchId,
        now,
      });
      const backup = await encryptLaunchVaultPayload(payload, createPassphrase, now);
      persistBackup(backup);
      setVault(payload);
      setNotice("Launch vault created and unlocked. The passphrase was cleared; only the encrypted blob was stored in this browser.");
      setCreatePassphrase("");
      setCreateConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the launch vault.");
    } finally {
      setBusy(null);
    }
  }

  async function handleUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();

    if (!encryptedBackup) {
      setError("No encrypted launch vault exists in this browser yet.");
      return;
    }

    setBusy("Unlocking vault…");
    try {
      const payload = await decryptLaunchVaultBackup(encryptedBackup, unlockPassphrase);
      setVault(payload);
      setUnlockPassphrase("");
      setNotice("Vault unlocked. Private keys are decrypted only in this React session and are never displayed.");
    } catch {
      setError("Unlock failed. Check the passphrase and encrypted vault backup.");
    } finally {
      setBusy(null);
    }
  }

  async function handleAddWallets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMessages();

    if (!vault || !encryptedBackup) {
      setError("Unlock the vault before adding launch wallets.");
      return;
    }

    setBusy("Deriving addresses and sealing vault…");
    try {
      const verifiedVault = await decryptLaunchVaultBackup(encryptedBackup, sealPassphrase);
      const imports = bulkMode
        ? parsePrivateKeyBulkImport(privateKeyInput, walletLabel, walletChain)
        : [deriveWalletFromPrivateKey(privateKeyInput, walletLabel, walletChain)];

      if (imports.length === 0) {
        throw new Error("No valid private keys were found. Paste one 64-byte hex key per line for bulk import.");
      }

      const now = Date.now();
      const merged = mergeVaultWallets(verifiedVault, imports, now);
      if (merged.added === 0) {
        setNotice(`No wallets added. ${merged.duplicates} derived address${merged.duplicates === 1 ? " was" : "es were"} already sealed in this vault.`);
        return;
      }

      const backup = await encryptLaunchVaultPayload(merged.payload, sealPassphrase, now);
      persistBackup(backup);
      setVault(merged.payload);
      setNotice(
        `${merged.added} wallet${merged.added === 1 ? "" : "s"} sealed. Derived addresses are visible; private keys were cleared from the form and remain encrypted at rest.`,
      );
      setWalletLabel("Launch wallet");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not seal wallet keys. The encrypted vault was not changed.");
    } finally {
      setPrivateKeyInput("");
      setSealPassphrase("");
      setBusy(null);
    }
  }

  async function handleRemoveWallet(walletId: string) {
    resetMessages();
    if (!vault || !encryptedBackup) return;
    const passphrase = window.prompt("Enter the launch vault passphrase to remove and re-seal this wallet.");
    if (!passphrase) return;

    setBusy("Removing wallet and re-sealing vault…");
    try {
      const verifiedVault = await decryptLaunchVaultBackup(encryptedBackup, passphrase);
      const nextVault = {
        ...verifiedVault,
        updatedAt: Date.now(),
        wallets: verifiedVault.wallets.filter((wallet) => wallet.id !== walletId),
      };
      const backup = await encryptLaunchVaultPayload(nextVault, passphrase);
      persistBackup(backup);
      setVault(nextVault);
      setNotice("Wallet removed and encrypted vault re-sealed. No plaintext key was exported or shown.");
    } catch {
      setError("Wallet removal failed. The passphrase did not unlock the existing encrypted vault.");
    } finally {
      setBusy(null);
    }
  }

  function handleLock() {
    setVault(null);
    setPrivateKeyInput("");
    setSealPassphrase("");
    setUnlockPassphrase("");
    setNotice("Vault locked. Decrypted keys were dropped from React state for this session.");
    setError(null);
  }

  function handleExportBackup() {
    resetMessages();
    if (!encryptedBackup) {
      setError("Create a vault before exporting an encrypted backup.");
      return;
    }
    const filename = `${vault?.launchId ?? "compas-launch-vault"}-encrypted-backup.json`;
    downloadTextFile(filename, serializeEncryptedLaunchVaultBackup(encryptedBackup));
    setNotice(`Downloaded ${filename}. It contains ciphertext only; keep the passphrase separately.`);
  }

  function handleWipeVault() {
    resetMessages();
    if (wipePhrase !== wipeConfirmation) {
      setError(`Type “${wipeConfirmation}” exactly to wipe the encrypted browser vault.`);
      return;
    }
    window.localStorage.removeItem(LAUNCH_VAULT_STORAGE_KEY);
    setEncryptedBackup(null);
    setVault(null);
    setPrivateKeyInput("");
    setSealPassphrase("");
    setUnlockPassphrase("");
    setWipePhrase("");
    setNotice("Encrypted launch vault wiped from localStorage. Existing downloaded backups, if any, are not affected.");
  }

  function persistBackup(backup: EncryptedLaunchVaultBackup) {
    const serialized = serializeEncryptedLaunchVaultBackup(backup);
    window.localStorage.setItem(LAUNCH_VAULT_STORAGE_KEY, serialized);
    setEncryptedBackup(backup);
  }

  function resetMessages() {
    setNotice(null);
    setError(null);
  }

  return (
    <div
      className={`${embedded ? "rounded-[2rem] border border-violet-100/90 bg-white/82 shadow-[0_24px_90px_rgba(77,63,132,0.12)]" : "min-h-screen bg-[radial-gradient(circle_at_top_left,#ede9fe_0,#f8fafc_36%,#ffffff_72%)]"} overflow-hidden text-slate-950`}
    >
      <main className={`mx-auto flex w-full max-w-7xl flex-col gap-6 ${embedded ? "px-4 py-5 sm:px-5" : "px-4 py-6 sm:px-6 lg:px-8"}`}>
        <VaultHero hasVault={Boolean(encryptedBackup)} isUnlocked={Boolean(vault)} walletCount={publicWallets.length} encryptedSize={encryptedSize} />

        {notice ? <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{notice}</div> : null}
        {error ? <div className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div> : null}
        {busy ? <div className="rounded-3xl border border-violet-200 bg-violet-50 p-4 text-sm font-black text-violet-700">{busy}</div> : null}

        <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <div className="grid gap-6">
            {!encryptedBackup ? (
              <CreateVaultPanel
                createConfirm={createConfirm}
                createLaunchId={createLaunchId}
                createLaunchName={createLaunchName}
                createPassphrase={createPassphrase}
                storageReady={storageReady}
                onCreateConfirm={setCreateConfirm}
                onCreateLaunchId={setCreateLaunchId}
                onCreateLaunchName={(value) => {
                  setCreateLaunchName(value);
                  setCreateLaunchId((current) => (current ? current : slugifyLaunchId(value)));
                }}
                onCreatePassphrase={setCreatePassphrase}
                onSubmit={handleCreateVault}
              />
            ) : vault ? (
              <UnlockedVaultPanel
                vault={vault}
                encryptedSize={encryptedSize}
                onExport={handleExportBackup}
                onLock={handleLock}
              />
            ) : (
              <UnlockVaultPanel unlockPassphrase={unlockPassphrase} onPassphrase={setUnlockPassphrase} onSubmit={handleUnlock} onExport={handleExportBackup} />
            )}

            <DangerPanel confirmation={wipeConfirmation} hasVault={Boolean(encryptedBackup)} wipePhrase={wipePhrase} onWipePhrase={setWipePhrase} onWipe={handleWipeVault} />
          </div>

          <div className="grid gap-6">
            {vault ? (
              <>
                <ImportWalletPanel
                  bulkMode={bulkMode}
                  chain={walletChain}
                  label={walletLabel}
                  privateKeyInput={privateKeyInput}
                  sealPassphrase={sealPassphrase}
                  onBulkMode={setBulkMode}
                  onChain={setWalletChain}
                  onLabel={setWalletLabel}
                  onPrivateKeyInput={setPrivateKeyInput}
                  onSealPassphrase={setSealPassphrase}
                  onSubmit={handleAddWallets}
                />
                <VaultWalletTable wallets={publicWallets} onRemove={handleRemoveWallet} />
              </>
            ) : (
              <LockedEducationPanel hasVault={Boolean(encryptedBackup)} />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function VaultHero({
  encryptedSize,
  hasVault,
  isUnlocked,
  walletCount,
}: {
  encryptedSize: string;
  hasVault: boolean;
  isUnlocked: boolean;
  walletCount: number;
}) {
  return (
    <header className="overflow-hidden rounded-[2rem] border border-violet-100 bg-white/90 p-5 shadow-sm backdrop-blur sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.35em] text-violet-600">Encrypted launch vault</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
            Per-launch key management without server custody.
          </h1>
          <p className="mt-4 max-w-3xl text-sm font-semibold leading-6 text-slate-500 sm:text-base">
            Create one browser-local vault per launch, unlock with a passphrase, seal imported private keys with Web Crypto AES-GCM, and show derived addresses only. No passphrase is stored, no keys leave React memory while unlocked, and no signing or broadcasting is wired here.
          </p>
        </div>
        <div className="grid gap-2 rounded-3xl border border-violet-100 bg-violet-50/70 p-4 text-center text-sm font-black text-violet-800 sm:min-w-80 sm:grid-cols-3 lg:grid-cols-1">
          <Metric label="State" value={isUnlocked ? "Unlocked" : hasVault ? "Locked" : "Empty"} />
          <Metric label="Derived" value={`${walletCount} addresses`} />
          <Metric label="Stored" value={hasVault ? encryptedSize : "No blob"} />
        </div>
      </div>
    </header>
  );
}

function CreateVaultPanel({
  createConfirm,
  createLaunchId,
  createLaunchName,
  createPassphrase,
  storageReady,
  onCreateConfirm,
  onCreateLaunchId,
  onCreateLaunchName,
  onCreatePassphrase,
  onSubmit,
}: {
  createConfirm: string;
  createLaunchId: string;
  createLaunchName: string;
  createPassphrase: string;
  storageReady: boolean;
  onCreateConfirm: (value: string) => void;
  onCreateLaunchId: (value: string) => void;
  onCreateLaunchName: (value: string) => void;
  onCreatePassphrase: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className={CARD}>
      <p className="text-xs font-black uppercase tracking-[0.24em] text-violet-600">Create launch vault</p>
      <h2 className="mt-2 text-2xl font-black text-slate-950">Start with an encrypted empty vault.</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
        The launch name and wallet private keys are sealed into one encrypted JSON blob stored at <code className="font-mono">localStorage</code>. Export a backup before wiping this browser.
      </p>

      <div className="mt-5 grid gap-3">
        <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
          Launch name
          <input value={createLaunchName} onChange={(event) => onCreateLaunchName(event.target.value)} className={`${FIELD} normal-case tracking-normal`} />
        </label>
        <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
          Launch ID
          <input value={createLaunchId} onChange={(event) => onCreateLaunchId(slugifyLaunchId(event.target.value))} className={`${FIELD} font-mono normal-case tracking-normal`} />
        </label>
        <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
          Passphrase
          <input value={createPassphrase} onChange={(event) => onCreatePassphrase(event.target.value)} minLength={12} type="password" autoComplete="new-password" className={FIELD} />
        </label>
        <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
          Confirm passphrase
          <input value={createConfirm} onChange={(event) => onCreateConfirm(event.target.value)} minLength={12} type="password" autoComplete="new-password" className={FIELD} />
        </label>
      </div>

      <button
        type="submit"
        disabled={!storageReady}
        className="mt-5 h-12 w-full rounded-2xl bg-violet-600 px-5 font-black text-white shadow-[0_16px_36px_rgba(124,58,237,0.24)] transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Create encrypted vault
      </button>
    </form>
  );
}

function UnlockVaultPanel({
  unlockPassphrase,
  onPassphrase,
  onSubmit,
  onExport,
}: {
  unlockPassphrase: string;
  onPassphrase: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onExport: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className={CARD}>
      <p className="text-xs font-black uppercase tracking-[0.24em] text-violet-600">Unlock vault</p>
      <h2 className="mt-2 text-2xl font-black text-slate-950">Encrypted vault found in this browser.</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
        Enter the launch passphrase to decrypt keys into this React session. The passphrase is cleared after unlock and is required again to seal edits.
      </p>
      <label className="mt-5 grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
        Passphrase
        <input value={unlockPassphrase} onChange={(event) => onPassphrase(event.target.value)} minLength={12} type="password" autoComplete="current-password" className={FIELD} />
      </label>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button type="submit" className="h-12 rounded-2xl bg-violet-600 px-5 font-black text-white transition hover:bg-violet-500">
          Unlock vault
        </button>
        <button type="button" onClick={onExport} className="h-12 rounded-2xl border border-violet-200 bg-white px-5 font-black text-violet-700 transition hover:bg-violet-50">
          Export encrypted backup
        </button>
      </div>
    </form>
  );
}

function UnlockedVaultPanel({
  encryptedSize,
  vault,
  onExport,
  onLock,
}: {
  encryptedSize: string;
  vault: LaunchVaultPayload;
  onExport: () => void;
  onLock: () => void;
}) {
  return (
    <section className={CARD}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-600">Unlocked</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">{vault.launchName}</h2>
          <p className="mt-1 font-mono text-xs font-bold text-slate-500">{vault.launchId}</p>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700">
          React memory only
        </span>
      </div>

      <div className="mt-5 grid gap-3 text-sm font-semibold sm:grid-cols-3">
        <InfoTile label="Addresses" value={vault.wallets.length} />
        <InfoTile label="Updated" value={formatVaultTimestamp(vault.updatedAt)} />
        <InfoTile label="Encrypted blob" value={encryptedSize} />
      </div>

      <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-800">
        Private keys are decrypted in memory for this unlocked session but never rendered. Re-sealing changes requires the passphrase again; locking drops decrypted keys from React state.
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={onLock} className="h-12 rounded-2xl bg-slate-950 px-5 font-black text-white transition hover:bg-slate-800">
          Lock vault
        </button>
        <button type="button" onClick={onExport} className="h-12 rounded-2xl border border-violet-200 bg-white px-5 font-black text-violet-700 transition hover:bg-violet-50">
          Export encrypted backup
        </button>
      </div>
    </section>
  );
}

function ImportWalletPanel({
  bulkMode,
  chain,
  label,
  privateKeyInput,
  sealPassphrase,
  onBulkMode,
  onChain,
  onLabel,
  onPrivateKeyInput,
  onSealPassphrase,
  onSubmit,
}: {
  bulkMode: boolean;
  chain: LaunchVaultChain;
  label: string;
  privateKeyInput: string;
  sealPassphrase: string;
  onBulkMode: (value: boolean) => void;
  onChain: (value: LaunchVaultChain) => void;
  onLabel: (value: string) => void;
  onPrivateKeyInput: (value: string) => void;
  onSealPassphrase: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className={CARD}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-violet-600">Add keys</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Import private keys, display addresses.</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
            Keys are parsed locally, converted to derived addresses, encrypted into the vault, and cleared from the form. They are not added to the shared planner store.
          </p>
        </div>
        <button type="button" onClick={() => onBulkMode(!bulkMode)} className={`h-10 rounded-full px-4 text-xs font-black transition ${bulkMode ? "bg-violet-600 text-white" : "border border-violet-100 bg-white text-violet-700"}`} aria-pressed={bulkMode}>
          {bulkMode ? "Bulk import" : "Single key"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_10rem]">
        <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
          Label prefix
          <input value={label} onChange={(event) => onLabel(event.target.value)} className={`${FIELD} normal-case tracking-normal`} />
        </label>
        <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
          Chain
          <select value={chain} onChange={(event) => onChain(event.target.value as LaunchVaultChain)} className={`${FIELD} normal-case tracking-normal`}>
            {CHAINS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-4 grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
        {bulkMode ? "Private keys (one per line)" : "Private key"}
        <textarea
          value={privateKeyInput}
          onChange={(event) => onPrivateKeyInput(event.target.value)}
          rows={bulkMode ? 8 : 3}
          spellCheck={false}
          autoComplete="off"
          placeholder={bulkMode ? "0x…\n0x…\n0x…" : "0x…"}
          className={`${TEXTAREA} font-mono normal-case tracking-normal`}
        />
      </label>

      <label className="mt-4 grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
        Passphrase to verify + re-seal
        <input value={sealPassphrase} onChange={(event) => onSealPassphrase(event.target.value)} minLength={12} type="password" autoComplete="current-password" className={FIELD} />
      </label>

      <button type="submit" className="mt-5 h-12 w-full rounded-2xl bg-violet-600 px-5 font-black text-white transition hover:bg-violet-500">
        Derive addresses and seal keys
      </button>
    </form>
  );
}

function VaultWalletTable({ wallets, onRemove }: { wallets: ReturnType<typeof toPublicLaunchWallet>[]; onRemove: (walletId: string) => void }) {
  return (
    <section className="overflow-hidden rounded-[2rem] border border-violet-100 bg-white/90 shadow-sm">
      <div className="flex flex-col gap-2 border-b border-violet-100 bg-violet-50/65 p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-violet-600">Derived addresses</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">Sealed wallet list</h2>
        </div>
        <span className="rounded-full bg-white px-4 py-2 text-xs font-black text-violet-700 shadow-sm">No private key display</span>
      </div>

      <div className="divide-y divide-violet-100">
        {wallets.map((wallet) => (
          <article key={wallet.id} className="grid gap-3 p-4 text-sm md:grid-cols-[1.1fr_1.4fr_0.5fr_0.5fr] md:items-center">
            <div>
              <p className="font-black text-slate-950">{wallet.label}</p>
              <p className="mt-1 text-xs font-semibold text-slate-400">Imported {formatVaultTimestamp(wallet.createdAt)}</p>
            </div>
            <p className="break-all font-mono text-xs font-bold text-slate-600" title={wallet.address}>{maskVaultAddress(wallet.address)}</p>
            <span className="w-fit rounded-full border border-violet-100 bg-violet-50 px-3 py-1 text-xs font-black text-violet-700">{wallet.chain}</span>
            <button type="button" onClick={() => onRemove(wallet.id)} className="h-10 rounded-xl border border-red-100 bg-red-50 px-3 text-xs font-black text-red-700 transition hover:bg-red-100">
              Remove
            </button>
          </article>
        ))}
        {wallets.length === 0 ? (
          <div className="p-8 text-center text-sm font-semibold text-slate-400">No launch wallet keys are sealed yet. Add a key to show its derived address here.</div>
        ) : null}
      </div>
    </section>
  );
}

function LockedEducationPanel({ hasVault }: { hasVault: boolean }) {
  return (
    <section className="grid gap-4">
      <div className="rounded-[2rem] border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-violet-200">Safety copy</p>
        <h2 className="mt-2 text-2xl font-black">What this vault will and will not do</h2>
        <ul className="mt-4 space-y-3 text-sm font-semibold leading-6 text-slate-200">
          <li>• Stores one encrypted blob in localStorage only; no API route receives secrets.</li>
          <li>• Requires the passphrase to unlock and again to re-seal edits; the passphrase is never stored.</li>
          <li>• Renders derived public addresses only, never seed phrases or private key text.</li>
          <li>• Does not sign, generate calldata, broadcast, disperse, or connect to wallet SDKs.</li>
        </ul>
      </div>
      <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-5 text-sm font-semibold leading-6 text-amber-800">
        <strong>{hasVault ? "Vault locked:" : "No vault yet:"}</strong> keep a downloaded encrypted backup and the passphrase in separate places. Wiping browser storage destroys the local copy.
      </div>
    </section>
  );
}

function DangerPanel({
  confirmation,
  hasVault,
  wipePhrase,
  onWipe,
  onWipePhrase,
}: {
  confirmation: string;
  hasVault: boolean;
  wipePhrase: string;
  onWipe: () => void;
  onWipePhrase: (value: string) => void;
}) {
  return (
    <section className="rounded-[2rem] border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-800">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-red-700">Delete / wipe</p>
      <h2 className="mt-2 text-xl font-black text-slate-950">Wipe the browser vault.</h2>
      <p className="mt-2 leading-6">This removes the encrypted blob from localStorage. It cannot recover keys without a separate encrypted backup and passphrase.</p>
      <label className="mt-4 grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-red-700">
        Type {confirmation}
        <input value={wipePhrase} onChange={(event) => onWipePhrase(event.target.value)} disabled={!hasVault} className={`${FIELD} border-red-200 focus:border-red-300 focus:ring-red-100`} />
      </label>
      <button type="button" onClick={onWipe} disabled={!hasVault} className="mt-4 h-11 w-full rounded-2xl bg-red-600 px-5 font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">
        Wipe encrypted launch vault
      </button>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white/80 px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.16em] text-violet-500">{label}</p>
      <p className="mt-1 text-base text-slate-950">{value}</p>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-violet-50/65 p-3">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-500">{label}</p>
      <p className="mt-1 break-all font-black text-slate-950">{value}</p>
    </div>
  );
}

function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
