"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { OpportunityScanResult } from "@/lib/opportunity-scan";
import { fetchSignedGateSession, type CompasGateSession } from "@/lib/compas-gate";
import { buildCompasAutopilotProposal, defaultCompasAutopilotPolicy, type CompasAutopilotPolicy } from "@/lib/compas-autopilot";

const WATCHLIST_KEY = "compas.opportunityWatchlist.v1";
const WATCHLIST_META_KEY = "compas.opportunityWatchlistMeta.v1";
const SCAN_HISTORY_KEY = "compas.opportunityScanHistory.v1";
const FIELD = "rounded-2xl border border-violet-100 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none shadow-sm placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100";

type WatchStatus = "watching" | "ready" | "ignored";
type WatchMeta = Record<string, { status: WatchStatus; note: string }>;

export default function OpportunityWatchPanel({ embedded = false }: { embedded?: boolean }) {
  const [watchlist, setWatchlist] = useState(() => readWatchlist());
  const [meta, setMeta] = useState<WatchMeta>(() => readWatchMeta());
  const [draft, setDraft] = useState("");
  const [chain, setChain] = useState("base");
  const [scan, setScan] = useState<OpportunityScanResult | null>(null);
  const [history, setHistory] = useState<OpportunityScanResult[]>(() => readScanHistory());
  const [busy, setBusy] = useState(false);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(0);
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [holderSession, setHolderSession] = useState<CompasGateSession | null>(null);
  const [autopilotPolicy, setAutopilotPolicy] = useState<CompasAutopilotPolicy>(() => defaultCompasAutopilotPolicy());

  const canScan = watchlist.length > 0 && !busy;
  const topCandidate = useMemo(() => scan?.candidates[0], [scan]);
  const selectedCandidate = scan?.candidates.find((candidate) => candidate.query === selectedQuery) ?? topCandidate;
  const autopilotProposal = useMemo(() => buildCompasAutopilotProposal({ scan, policy: autopilotPolicy, holderAddress: holderSession?.address }), [scan, autopilotPolicy, holderSession]);

  useEffect(() => {
    fetchSignedGateSession().then(setHolderSession).catch(() => setHolderSession(null));
  }, []);

  useEffect(() => {
    if (!autoRefreshSeconds || watchlist.length === 0) return;
    const timer = window.setInterval(() => {
      void runScan();
    }, autoRefreshSeconds * 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshSeconds, watchlist, chain]);

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
    const nextMeta = { ...meta, [value]: meta[value] ?? { status: "watching" as WatchStatus, note: "" } };
    setMeta(nextMeta);
    writeWatchMeta(nextMeta);
    setDraft("");
    setError(null);
  }

  function removeItem(item: string) {
    const next = watchlist.filter((candidate) => candidate !== item);
    setWatchlist(next);
    writeWatchlist(next);
    const nextMeta = { ...meta };
    delete nextMeta[item];
    setMeta(nextMeta);
    writeWatchMeta(nextMeta);
    if (selectedQuery === item) setSelectedQuery(null);
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
    downloadText(`opportunity-scan-${Date.now()}.json`, `${JSON.stringify(scan, null, 2)}\n`, "application/json");
  }

  function clearHistory() {
    setHistory([]);
    writeScanHistory([]);
  }

  function updateItemMeta(item: string, patch: Partial<{ status: WatchStatus; note: string }>) {
    const next = { ...meta, [item]: { status: meta[item]?.status ?? "watching", note: meta[item]?.note ?? "", ...patch } };
    setMeta(next);
    writeWatchMeta(next);
  }

  function exportScanCsv() {
    if (!scan) return;
    const header = ["query", "name", "chain", "address", "signal", "score", "nextAction", "openStageCount", "executableStageCount", "warnings", "status", "note"];
    const rows = scan.candidates.map((candidate) => {
      const itemMeta = meta[candidate.query];
      return [candidate.query, candidate.name, candidate.chain, candidate.address, candidate.signal, candidate.score, candidate.nextAction, candidate.openStageCount, candidate.executableStageCount, candidate.warnings.join("; "), itemMeta?.status ?? "watching", itemMeta?.note ?? ""];
    });
    downloadText(`opportunity-scan-${Date.now()}.csv`, [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n", "text/csv");
  }

  function exportWatchlistJson() {
    const payload = { schemaVersion: "compas-watchlist.v1", exportedAt: new Date().toISOString(), chain, watchlist: watchlist.map((item) => ({ query: item, ...meta[item] })) };
    downloadText(`watchlist-${Date.now()}.json`, `${JSON.stringify(payload, null, 2)}\n`, "application/json");
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
            {watchlist.length ? watchlist.map((item) => {
              const itemMeta = meta[item] ?? { status: "watching" as WatchStatus, note: "" };
              return (
              <div key={item} className="grid gap-2 rounded-2xl border border-violet-100 bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => setSelectedQuery(item)} className="truncate font-mono text-xs font-bold text-slate-600 hover:text-violet-700">{item}</button>
                  <button type="button" onClick={() => removeItem(item)} className="rounded-full border border-slate-200 px-2 py-1 text-xs font-black text-slate-500">Remove</button>
                </div>
                <div className="grid gap-2 sm:grid-cols-[0.7fr_1.3fr]">
                  <select value={itemMeta.status} onChange={(event) => updateItemMeta(item, { status: event.target.value as WatchStatus })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
                    <option value="watching">watching</option>
                    <option value="ready">ready</option>
                    <option value="ignored">ignored</option>
                  </select>
                  <input value={itemMeta.note} onChange={(event) => updateItemMeta(item, { note: event.target.value })} placeholder="note" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 outline-none" />
                </div>
              </div>
            );
            }) : <p className="rounded-2xl border border-dashed border-violet-200 bg-white/70 px-3 py-6 text-center text-sm font-semibold text-slate-500">No watchlist yet.</p>}
          </div>

          <button type="button" onClick={runScan} disabled={!canScan} className="mt-4 w-full rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "Scanning…" : "Run preview scan"}
          </button>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={downloadLatestScan} disabled={!scan} className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">Export JSON</button>
            <button type="button" onClick={exportScanCsv} disabled={!scan} className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">Export CSV</button>
            <button type="button" onClick={exportWatchlistJson} disabled={watchlist.length === 0} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-600 disabled:cursor-not-allowed disabled:opacity-50">Export watchlist</button>
            <button type="button" onClick={clearHistory} disabled={history.length === 0} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500 disabled:cursor-not-allowed disabled:opacity-50">Clear history</button>
          </div>
          <label className="mt-3 grid gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            Auto-refresh
            <select value={autoRefreshSeconds} onChange={(event) => setAutoRefreshSeconds(Number(event.target.value))} className={FIELD}>
              <option value={0}>Off</option>
              <option value={60}>Every 1 min</option>
              <option value={300}>Every 5 min</option>
              <option value={900}>Every 15 min</option>
            </select>
          </label>
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

          <AutopilotPanel policy={autopilotPolicy} setPolicy={setAutopilotPolicy} proposal={autopilotProposal} holderAddress={holderSession?.address} />

          {selectedCandidate ? <CandidateDetail candidate={selectedCandidate} meta={meta[selectedCandidate.query]} /> : null}

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

function AutopilotPanel({ holderAddress, policy, proposal, setPolicy }: { holderAddress?: string; policy: CompasAutopilotPolicy; proposal: ReturnType<typeof buildCompasAutopilotProposal>; setPolicy: (policy: CompasAutopilotPolicy) => void }) {
  return (
    <section className="mt-4 rounded-3xl border border-fuchsia-200 bg-fuchsia-50/70 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-700">Compas autopilot</p>
          <h3 className="mt-1 text-lg font-black text-slate-950">Auto-scan → auto-propose → manual broadcast</h3>
          <p className="mt-1 text-xs font-bold text-slate-600">Fully automated discovery/proposal for Compas holder recipient. Real ETH broadcast remains explicit/manual.</p>
        </div>
        <label className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-black text-fuchsia-700">
          <input type="checkbox" checked={policy.enabled} onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })} /> Enabled
        </label>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <input aria-label="Max total ETH" type="number" step="0.001" value={policy.maxTotalEth} onChange={(event) => setPolicy({ ...policy, maxTotalEth: Number(event.target.value) })} className={FIELD} />
        <input aria-label="Max quantity" type="number" value={policy.maxQuantity} onChange={(event) => setPolicy({ ...policy, maxQuantity: Number(event.target.value) })} className={FIELD} />
        <input aria-label="Max gas gwei" type="number" step="0.001" value={policy.maxGasGwei} onChange={(event) => setPolicy({ ...policy, maxGasGwei: Number(event.target.value) })} className={FIELD} />
        <select value={policy.mode} onChange={(event) => setPolicy({ ...policy, mode: event.target.value as CompasAutopilotPolicy["mode"] })} className={FIELD}>
          <option value="auto-propose">auto-propose</option>
          <option value="auto-simulate">auto-simulate draft</option>
        </select>
      </div>
      <div className="mt-3 rounded-2xl bg-white p-3 text-xs font-bold text-slate-600">
        Holder recipient: {holderAddress ? holderAddress : "connect/sign as Compas holder to resolve"}
      </div>
      {proposal ? (
        <div className="mt-3 rounded-2xl border border-fuchsia-200 bg-white p-3">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-700">Proposed plan</p>
          <p className="mt-2 text-sm font-black text-slate-950">{proposal.candidate.name} · {proposal.candidate.chain} · score {proposal.candidate.score}</p>
          <p className="mt-1 text-xs font-bold text-slate-600">Qty {proposal.proposedPlan.quantity} · max {proposal.proposedPlan.maxTotalEth} ETH · recipient {proposal.recipient.status}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {proposal.checklist.map((item) => <span key={item.label} className={`rounded-2xl border px-3 py-2 text-xs font-black ${item.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{item.ok ? "✓" : "○"} {item.label}</span>)}
          </div>
        </div>
      ) : <p className="mt-3 rounded-2xl border border-dashed border-fuchsia-200 bg-white/70 p-3 text-xs font-bold text-slate-500">Run a scan to generate an autopilot proposal.</p>}
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

function CandidateDetail({ candidate, meta }: { candidate: OpportunityScanResult["candidates"][number]; meta?: { status: WatchStatus; note: string } }) {
  const checklist = [
    { label: "Contract resolved", ok: /^0x[a-fA-F0-9]{40}$/.test(candidate.address) },
    { label: "Executable public stage", ok: candidate.executableStageCount > 0 },
    { label: "No discovery warnings", ok: candidate.warnings.length === 0 },
    { label: "Marked ready by operator", ok: meta?.status === "ready" },
  ];
  return (
    <aside className="mt-4 rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Candidate detail</p>
          <h3 className="mt-1 text-lg font-black text-slate-950">{candidate.name}</h3>
          <p className="font-mono text-xs font-bold text-slate-500">{candidate.chain} · {candidate.address}</p>
        </div>
        <span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-violet-700">{meta?.status ?? "watching"}</span>
      </div>
      {meta?.note ? <p className="mt-3 rounded-2xl bg-white p-3 text-sm font-semibold text-slate-600">{meta.note}</p> : null}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {checklist.map((item) => <div key={item.label} className={`rounded-2xl border px-3 py-2 text-xs font-black ${item.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{item.ok ? "✓" : "○"} {item.label}</div>)}
      </div>
      {candidate.warnings.length ? <ul className="mt-3 list-inside list-disc text-xs font-bold text-amber-800">{candidate.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    </aside>
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

function readWatchMeta(): WatchMeta {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WATCHLIST_META_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as WatchMeta;
  } catch {
    return {};
  }
}

function writeWatchMeta(meta: WatchMeta) {
  window.localStorage.setItem(WATCHLIST_META_KEY, JSON.stringify(meta));
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

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}
