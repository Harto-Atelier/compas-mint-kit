"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

import { clearGateSession, readGateSession, type CompasGateSession } from "@/lib/compas-gate";

const noopSubscribe = () => () => {};
let cachedRaw: string | null | undefined;
let cachedSession: CompasGateSession | null = null;

function getGateSnapshot(): CompasGateSession | null {
  const raw = window.sessionStorage.getItem("compas.walletGate.v1");
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSession = readGateSession();
  }
  return cachedSession;
}

function getServerSnapshot(): CompasGateSession | null {
  return null;
}

export default function CompasGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const session = useSyncExternalStore(noopSubscribe, getGateSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  if (!hydrated) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f7f7f6] px-4">
        <p className="text-sm font-black text-neutral-500">Checking access…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f7f7f6] px-4 text-center">
        <div className="w-full max-w-md rounded-[1.75rem] border border-neutral-200 bg-white p-6 shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#635bff]">Compas holder access</p>
          <h1 className="mt-2 text-2xl font-black text-neutral-950">Console is wallet-gated</h1>
          <p className="mt-3 text-sm font-medium leading-6 text-neutral-600">
            Connect a wallet holding at least one Compas from the landing page to enter the mint console.
          </p>
          <Link href="/" className="mt-5 inline-flex h-11 items-center justify-center rounded-2xl bg-[#635bff] px-6 text-sm font-black text-white shadow-lg shadow-[#635bff]/25 hover:bg-[#5148ee]">
            Go to login →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <>
      {session ? (
        <div className="flex items-center justify-between gap-3 bg-neutral-950 px-4 py-1.5 text-[11px] font-bold text-white">
          <span className="truncate">
            Compas holder {`${session.address.slice(0, 6)}…${session.address.slice(-4)}`} · {session.compasCount} Compas
          </span>
          <button
            type="button"
            onClick={() => {
              clearGateSession();
              router.push("/");
            }}
            className="shrink-0 rounded-full border border-white/25 px-3 py-0.5 font-black hover:bg-white/10"
          >
            Disconnect
          </button>
        </div>
      ) : null}
      {children}
    </>
  );
}
