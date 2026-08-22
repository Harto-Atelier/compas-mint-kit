"use client";

import { useMemo, useState } from "react";
import { usePlannerStore } from "@/app/components/PlannerStoreProvider";
import { isPlannerAddress, shortenWalletAddress } from "@/lib/planner-store";
import {
  DISPERSE_ASSET_TYPES,
  DISPERSE_CURRENCIES,
  type DisperseAssetType,
  type DisperseCurrency,
} from "@/lib/mint-console-data";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const PANEL_CLASS = "rounded-[2rem] border border-violet-100 bg-white/88 p-5 shadow-sm backdrop-blur-xl lg:p-6";
const MINI_CARD_CLASS = "rounded-3xl border border-violet-100 bg-white/80 p-4 shadow-sm";
const LABEL_CLASS = "text-xs font-black uppercase tracking-[0.22em] text-slate-500";
const INPUT_CLASS = "mt-2 w-full rounded-2xl border border-violet-100 bg-white px-4 py-3 font-semibold text-slate-950 outline-none shadow-sm placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100";

const PRIVATE_KEY_LIKE_RE = /(?:^|[\s,\t])(?:0x)?[a-fA-F0-9]{64}(?=$|[\s,\t])/;

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
      <p className="mb-2 text-xs font-black uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <div className="grid grid-cols-2 rounded-full border border-violet-100 bg-violet-50/80 p-1">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className={cx(
              "rounded-full px-4 py-2 text-sm font-black transition",
              active === value ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-violet-700",
            )}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DispersePanel({ embedded = false }: { embedded?: boolean }) {
  const { wallets } = usePlannerStore();
  const [assetType, setAssetType] = useState<DisperseAssetType>("NFT");
  const [currency, setCurrency] = useState<DisperseCurrency>("ETH");
  const [amountPerWallet, setAmountPerWallet] = useState("1");
  const [recipientsRaw, setRecipientsRaw] = useState("");
  const [secretNotice, setSecretNotice] = useState("");

  const recipients = useMemo(
    () =>
      recipientsRaw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => isPlannerAddress(line)),
    [recipientsRaw],
  );

  function updateRecipients(raw: string) {
    if (PRIVATE_KEY_LIKE_RE.test(raw)) {
      setRecipientsRaw("");
      setSecretNotice("Private-key-shaped text detected and cleared. Paste public 0x addresses only.");
      return;
    }
    setSecretNotice("");
    setRecipientsRaw(raw);
  }

  const amountLabel = `${amountPerWallet || "0"} ${assetType === "NFT" ? "NFT" : currency}`;

  return (
    <section className={cx(PANEL_CLASS, embedded && "shadow-none")}>
      <div className="flex flex-col gap-3 border-b border-violet-100 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-violet-600">Disperse planner</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Flat wallet distribution draft</h2>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
            Draft a flat per-wallet funding plan from your staged planner wallets. This planner produces no transaction
            payload and nothing is broadcast from the webapp.
          </p>
        </div>
        <span className="w-fit rounded-full border border-violet-100 bg-violet-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-violet-700">
          draft only · no broadcast
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Segment label="Asset" values={DISPERSE_ASSET_TYPES} active={assetType} onChange={setAssetType} />
            <Segment label="Currency" values={DISPERSE_CURRENCIES} active={currency} onChange={setCurrency} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={MINI_CARD_CLASS}>
              <span className={LABEL_CLASS}>Per wallet amount</span>
              <input
                value={amountPerWallet}
                onChange={(event) => setAmountPerWallet(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                className={INPUT_CLASS}
              />
            </label>
            <div className={MINI_CARD_CLASS}>
              <span className={LABEL_CLASS}>Plan summary</span>
              <p className="mt-2 rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3 text-sm font-black text-slate-950">
                {recipients.length} recipient{recipients.length === 1 ? "" : "s"} × {amountLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-2xl border border-violet-100 bg-slate-100 px-5 py-4 text-sm font-black uppercase tracking-[0.22em] text-slate-400"
          >
            Disperse disabled · no broadcast wired
          </button>
          <p className="text-xs font-semibold leading-5 text-slate-500">
            Execution is intentionally not wired in this console. Use the exported run config with your local CLI to fund
            wallets from an operator machine.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className={MINI_CARD_CLASS}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-black text-slate-950">Senders · staged wallets</h3>
              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-black text-violet-700">{wallets.length}</span>
            </div>
            {wallets.length > 0 ? (
              <div className="space-y-2">
                {wallets.map((wallet) => (
                  <div key={wallet.id} className="flex items-center justify-between rounded-2xl border border-violet-100 bg-white px-3 py-2">
                    <div>
                      <p className="text-sm font-black text-slate-950">{wallet.name}</p>
                      <p className="font-mono text-xs font-semibold text-slate-500">{shortenWalletAddress(wallet.address)}</p>
                    </div>
                    <span className="rounded-full border border-violet-100 bg-violet-50 px-2 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-violet-700">
                      {wallet.chain}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-violet-200 bg-violet-50/40 px-3 py-6 text-center text-sm font-semibold text-slate-500">
                No wallets staged yet. Add wallets in the Wallets tab to use them as senders.
              </p>
            )}
          </div>
          <div className={MINI_CARD_CLASS}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-black text-slate-950">Recipients</h3>
              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-black text-violet-700">{recipients.length}</span>
            </div>
            <label className="block">
              <span className="sr-only">Recipient addresses, one per line</span>
              <textarea
                value={recipientsRaw}
                onChange={(event) => updateRecipients(event.target.value)}
                rows={6}
                placeholder={"0x… one public address per line"}
                className={`${INPUT_CLASS} mt-0 h-auto font-mono text-xs`}
              />
            </label>
            {secretNotice ? (
              <p className="mt-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{secretNotice}</p>
            ) : null}
            {recipients.length > 0 ? (
              <div className="mt-3 space-y-1">
                {recipients.map((address) => (
                  <p key={address} className="rounded-xl border border-violet-100 bg-white px-3 py-1.5 font-mono text-xs font-semibold text-slate-600">
                    {shortenWalletAddress(address)}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs font-semibold text-slate-400">No valid recipient addresses yet.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function AcoPanel({ embedded = false }: { embedded?: boolean }) {
  return (
    <section className={cx(PANEL_CLASS, embedded && "shadow-none")}>
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-violet-600">Automation</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">No automation configured</h2>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
            This console does not run watchers, schedulers, or bots. No signer, relay, or RPC broadcaster is connected, and
            nothing executes unattended.
          </p>
        </div>
        <span className="w-fit rounded-full border border-violet-100 bg-violet-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-violet-700">
          no signer connected
        </span>
      </div>
      <div className="rounded-3xl border border-dashed border-violet-200 bg-violet-50/40 p-6 text-center">
        <p className="text-sm font-black text-slate-950">Nothing scheduled to run automatically.</p>
        <p className="mx-auto mt-2 max-w-xl text-sm font-semibold leading-6 text-slate-500">
          To execute a planned mint run, export the run config from the Mints tab and use the local CLI on an operator
          machine. Automated execution is intentionally out of scope for this webapp.
        </p>
      </div>
    </section>
  );
}
