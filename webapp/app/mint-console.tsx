"use client";

import { AcoPanel, DispersePanel, SafetyStrip } from "@/app/components/DisperseAcoPanels";

export default function MintConsole() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#ede9fe_0,#f8fafc_36%,#ffffff_72%)] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="overflow-hidden rounded-[2.5rem] border border-violet-100 bg-white/88 p-6 shadow-sm backdrop-blur-xl lg:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.35em] text-violet-600">Compas mint kit</p>
              <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                Mint console preview for Disperse, ACO, queues, and analytics.
              </h1>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-slate-500">
                Holder-facing control-room layout for public mint planning. It shows the intended Umi-style Disperse shape,
                scheduled review lanes, and analytic fixtures without enabling execution.
              </p>
            </div>
            <div className="rounded-3xl border border-violet-100 bg-violet-50 p-4 text-sm font-semibold text-slate-600 lg:w-80">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-600">Environment</p>
              <p className="mt-2 text-lg font-black text-slate-950">Preview-only UI</p>
              <p className="mt-2 leading-6">
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
      </div>
    </main>
  );
}
