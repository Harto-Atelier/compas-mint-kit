"use client";

import { useState } from "react";
import {
  ACO_PLACEHOLDERS,
  DISPERSE_ASSET_TYPES,
  DISPERSE_CURRENCIES,
  DISPERSE_PREVIEW,
  PREVIEW_SAFETY,
  type DisperseAssetType,
  type DisperseCurrency,
  shortenWallet,
} from "@/lib/mint-console-data";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const PANEL_CLASS = "rounded-[2rem] border border-violet-100 bg-white/88 p-5 shadow-sm backdrop-blur-xl lg:p-6";
const MINI_CARD_CLASS = "rounded-3xl border border-violet-100 bg-white/80 p-4 shadow-sm";
const LABEL_CLASS = "text-xs font-black uppercase tracking-[0.22em] text-slate-500";
const INPUT_CLASS = "mt-2 w-full rounded-2xl border border-violet-100 bg-white px-4 py-3 font-semibold text-slate-950 outline-none shadow-sm";

export function SafetyStrip({ embedded = false }: { embedded?: boolean }) {
  return (
    <section
      className={cx(
        "rounded-[2rem] border border-emerald-200 bg-emerald-50 p-5 text-sm font-semibold text-emerald-800 shadow-sm",
        embedded && "shadow-none",
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-emerald-600">Preview safety lock</p>
          <h2 className="mt-1 text-xl font-black text-slate-950">No custody · no signing · no broadcast</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <span className="rounded-full border border-emerald-200 bg-white/70 px-3 py-2">Execution: {PREVIEW_SAFETY.execution}</span>
          <span className="rounded-full border border-emerald-200 bg-white/70 px-3 py-2">Broadcast: {String(PREVIEW_SAFETY.broadcast)}</span>
          <span className="rounded-full border border-emerald-200 bg-white/70 px-3 py-2">Custody: {String(PREVIEW_SAFETY.custody)}</span>
          <span className="rounded-full border border-emerald-200 bg-white/70 px-3 py-2">Source: {PREVIEW_SAFETY.source}</span>
        </div>
      </div>
      <p className="mt-3 max-w-4xl text-emerald-700">{PREVIEW_SAFETY.note}</p>
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

function WalletList({ title, wallets }: { title: string; wallets: typeof DISPERSE_PREVIEW.senders }) {
  return (
    <div className={MINI_CARD_CLASS}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-black text-slate-950">{title}</h3>
        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-black text-violet-700">{wallets.length}</span>
      </div>
      <div className="space-y-2">
        {wallets.map((wallet) => (
          <div key={wallet.wallet} className="flex items-center justify-between rounded-2xl border border-violet-100 bg-white px-3 py-2">
            <div>
              <p className="text-sm font-black text-slate-950">{wallet.label}</p>
              <p className="font-mono text-xs font-semibold text-slate-500">{shortenWallet(wallet.wallet)}</p>
            </div>
            <span className="rounded-full border border-violet-100 bg-violet-50 px-2 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-violet-700">
              {wallet.role}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DispersePanel({ embedded = false }: { embedded?: boolean }) {
  const [assetType, setAssetType] = useState<DisperseAssetType>(DISPERSE_PREVIEW.assetType);
  const [currency, setCurrency] = useState<DisperseCurrency>(DISPERSE_PREVIEW.currency);

  return (
    <section className={cx(PANEL_CLASS, embedded && "shadow-none")}>
      <div className="flex flex-col gap-3 border-b border-violet-100 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-violet-600">Disperse preview</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Flat wallet distribution builder</h2>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
            Umi-style sender/recipient planner with NFT/ERC20 and ETH/USD controls. The Disperse action is disabled and
            emits no transaction payload.
          </p>
        </div>
        <span className="w-fit rounded-full border border-violet-100 bg-violet-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-violet-700">
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
            <label className={MINI_CARD_CLASS}>
              <span className={LABEL_CLASS}>Mode</span>
              <input readOnly value={DISPERSE_PREVIEW.mode} className={INPUT_CLASS} />
            </label>
            <label className={MINI_CARD_CLASS}>
              <span className={LABEL_CLASS}>Per wallet amount</span>
              <input readOnly value={`${DISPERSE_PREVIEW.amountPerWallet} ${assetType === "NFT" ? "NFT" : currency}`} className={INPUT_CLASS} />
            </label>
          </div>
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-2xl border border-violet-100 bg-slate-100 px-5 py-4 text-sm font-black uppercase tracking-[0.22em] text-slate-400"
          >
            Disperse disabled · no broadcast
          </button>
          <p className="text-xs font-semibold leading-5 text-slate-500">{DISPERSE_PREVIEW.note}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <WalletList title="Senders" wallets={DISPERSE_PREVIEW.senders} />
          <WalletList title="Recipients" wallets={DISPERSE_PREVIEW.recipients} />
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
          <p className="text-xs font-black uppercase tracking-[0.28em] text-violet-600">ACO placeholders</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Agent collection operator preview</h2>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
            Watch-only scheduling cards for mint windows, holder review, and risk alerts. These rows are advisory fixtures,
            not autonomous execution.
          </p>
        </div>
        <span className="w-fit rounded-full border border-violet-100 bg-violet-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-violet-700">
          no signer connected
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {ACO_PLACEHOLDERS.map((item) => (
          <article key={item.label} className={MINI_CARD_CLASS}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-black text-slate-950">{item.label}</h3>
              <span className="rounded-full border border-violet-100 bg-violet-50 px-2 py-1 text-[11px] font-black text-violet-700">
                {item.state.replace("-", " ")}
              </span>
            </div>
            <dl className="mt-4 space-y-2 text-sm font-semibold">
              <div className="flex justify-between gap-3 text-slate-500">
                <dt>Cadence</dt>
                <dd className="text-right text-slate-800">{item.cadence}</dd>
              </div>
              <div className="flex justify-between gap-3 text-slate-500">
                <dt>Next</dt>
                <dd className="text-right text-slate-800">{item.nextWindow}</dd>
              </div>
              <div className="flex justify-between gap-3 text-slate-500">
                <dt>Broadcast</dt>
                <dd className="text-right text-slate-800">{String(item.broadcast)}</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">{item.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
