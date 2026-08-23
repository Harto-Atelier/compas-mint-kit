"use client";

import { FormEvent, useMemo, useState } from "react";
import type { OpportunityScanResult } from "@/lib/opportunity-scan";

const WATCHLIST_KEY = "compas.opportunityWatchlist.v1";
const SCAN_HISTORY_KEY = "compas.opportunityScanHistory.v1";
const FIELD = "rounded-2xl border border-violet-100 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none shadow-sm placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100";

export default function OpportunityWatchPanel({ embedded = false }: { embedded?: boolean }) {
  const [watchlist, setWatchlist] = useState(() => readWatchlist());
  const [draft, setDraft] = useState("");
  const [chain, setChain] = useState("base");
  const [scan, setScan] = useState<OpportunityScanResult | null>(null);
  const [history, setHistory] = useState<OpportunityScanResult[]>(() => readScanHistory());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canScan = watchlist.length > 0 && !busy;
  const topCandidate = useMemo(() => scan?.candidates[0], [scan]);

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    if (/(?:^|[\s,/?#=&._-])(?:0x)?[a-fA-F0-9]{64}(?=$|[\s,/?#=&._-])/.test(value)) {
      setDraft("");
      setError("Private-key-shaped text cleared. Add only collection slugs, URLs, or public contracts.");
      return;
    }
    const next = Array.from(new Set([value, ...watchlist])).slice(0, 8);
    setWatchlist(next);
    writeWatchlist(next);
    setDraft("");
    setError(null);
  }

  function removeItem(item: string) {
    const next = watchlist.filter((candidate) => candidate !== item);
    setWatchlist(next);
    writeWatchlist(next);
  }

  async function runScan() {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({ items: watchlist.join(","), chain });
      const response = await fetch(`/api/opportunities/scan?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as OpportunityScanResult;
      if (!response.ok) throw new Error("Opportunity scan failed.");
      setScan(body);
      const nextHistory = [body, ...history].slice(0, 5);
      setHistory(nextHistory);
      writeScanHistory(nextHistory);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function downloadLatestScan() {
    if (!scan) return;
    const blob = new Blob([`${JSON.stringify(scan, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `opportunity-scan-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function clearHistory() {
    setHistory([]);
    writeScanHistory([]);
  }

  return (
    <section className={`rounded-[2rem] border border-violet-100 bg-white/90 p-5 shadow-sm ${embedded ? "shadow-none" : ""}`}>
      <div className="flex flex-col gap-3 border-b border-violet-100 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-violet-600">Watchlist</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Scan drops before you spend attention.</h2>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
            Add slugs, OpenSea links, or public contracts. The tick checks metadata and SeaDrop state, ranks candidates, and never signs or broadcasts.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-violet-100 bg-violet-50 p-2 text-center text-xs font-black text-violet-700">
          <span className="rounded-xl bg-white px-3 py-2">exec none</span>
          <span className="rounded-xl bg-white px-3 py-2">broadcast false</span>
        </div>
      </div>

      {error ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-3xl border border-violet-100 bg-violet-50/50 p-4">
          <form onSubmit={addItem} className="grid gap-3">
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              Add collection
              <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="slug, OpenSea URL, or 0x contract" className={FIELD} />
            </label>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <select value={chain} onChange={(event) => setChain(event.target.value)} className={FIELD}>
                <option value="base">Base</option>
                <option value="ethereum">Ethereum</option>
                <option value="robinhood">Robinhood</option>
              </select>
              <button type="submit" className="rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-violet-500">Add</button>
            </div>
          </form>

          <div className="mt-4 space-y-2">
            {watchlist.length ? watchlist.map((item) => (
              <div key={item} className="flex items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white px-3 py-2">
                <span className="truncate font-mono text-xs font-bold text-slate-600">{item}</span>
                <button type="button" onClick={() => removeItem(item)} className="rounded-full border border-slate-200 px-2 py-1 text-xs font-black text-slate-500">Remove</button>
              </div>
            )) : <p className="rounded-2xl border border-dashed border-violet-200 bg-white/70 px-3 py-6 text-center text-sm font-semibold text-slate-500">No watchlist yet.</p>}
          </div>

          <button type="button" onClick={runScan} disabled={!canScan} className="mt-4 w-full rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "Scanning…" : "Run preview scan"}
          </button>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={downloadLatestScan} disabled={!scan} className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">Export latest</button>
            <button type="button" onClick={clearHistory} disabled={history.length === 0} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500 disabled:cursor-not-allowed disabled:opacity-50">Clear history</button>
          </div>
        </div>

        <div className="rounded-3xl border border-violet-100 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Checked" value={scan?.checked ?? watchlist.length} />
            <Metric label="Candidates" value={scan?.candidates.length ?? "—"} />
            <Metric label="Errors" value={scan?.errors.length ?? "—"} />
            <Metric label="Mode" value={scan?.mode ?? "preview"} />
          </div>

          {topCandidate ? (
            <div className="mt-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Top signal</p>
              <h3 className="mt-2 text-xl font-black text-slate-950">{topCandidate.name}</h3>
              <p className="mt-1 text-sm font-bold text-emerald-800">{topCandidate.nextAction} · score {topCandidate.score}</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{topCandidate.reason}</p>
            </div>
          ) : <p className="mt-4 rounded-3xl border border-dashed border-violet-200 bg-violet-50/60 p-6 text-center text-sm font-semibold text-slate-500">Run a scan to see ranked opportunities.</p>}

          {scan?.candidates.length ? <div className="mt-4 space-y-2">{scan.candidates.map((candidate) => <CandidateRow key={`${candidate.query}-${candidate.address}`} candidate={candidate} />)}</div> : null}
          {scan?.errors.length ? <ul className="mt-4 space-y-1 text-xs font-bold text-amber-700">{scan.errors.map((err) => <li key={err.query}>⚠ {err.query}: {err.error}</li>)}</ul> : null}
          {history.length ? (
            <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Local scan history</p>
              <div className="mt-3 space-y-2">
                {history.map((item) => (
                  <button key={item.generatedAt} type="button" onClick={() => setScan(item)} className="grid w-full gap-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-bold text-slate-600 hover:border-violet-200">
                    <span className="font-black text-slate-950">{new Date(item.generatedAt).toLocaleString()} · {item.candidates.length} candidates</span>
                    <span>checked {item.checked} · errors {item.errors.length} · preview only</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CandidateRow({ candidate }: { candidate: OpportunityScanResult["candidates"][number] }) {
  const tone = candidate.signal === "ready" ? "text-emerald-700 bg-emerald-50 border-emerald-200" : candidate.signal === "watch" ? "text-amber-700 bg-amber-50 border-amber-200" : "text-red-700 bg-red-50 border-red-200";
  return (
    <article className="grid gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate font-black text-slate-950">{candidate.name}</p>
        <p className="font-mono text-xs font-semibold text-slate-500">{candidate.address}</p>
      </div>
      <span className={`w-fit rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${tone}`}>{candidate.signal} · {candidate.score}</span>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border border-violet-100 bg-violet-50/50 p-3"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p><p className="mt-1 text-sm font-black text-slate-950">{value}</p></div>;
}

function readWatchlist(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WATCHLIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function writeWatchlist(items: string[]) {
  window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items));
}

function readScanHistory(): OpportunityScanResult[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SCAN_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed.slice(0, 5) as OpportunityScanResult[]) : [];
  } catch {
    return [];
  }
}

function writeScanHistory(items: OpportunityScanResult[]) {
  window.localStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(items.slice(0, 5)));
}
