"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { parseRunReportJson, type NormalizedRunReport, type NormalizedRunTransaction, type RunReportStatus, type RunStageSummary } from "@/lib/run-report";

type ReportTab = "Minted" | "Transactions" | "Analytics";

const REPORT_TABS: ReportTab[] = ["Minted", "Transactions", "Analytics"];
const SAMPLE_FILENAME = "compas-cli-run-report.json";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function RunReportViewer({ embedded = false }: { embedded?: boolean }) {
  const [rawText, setRawText] = useState("");
  const [sourceName, setSourceName] = useState(SAMPLE_FILENAME);
  const [report, setReport] = useState<NormalizedRunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>("Minted");

  const importStatus = useMemo(() => {
    if (!report) return "Waiting for a CLI run-report JSON.";
    return `${report.transactions.length} transaction row(s) imported from ${report.sourceName}.`;
  }, [report]);

  function importReport(text: string, filename = sourceName) {
    setError(null);
    try {
      const nextReport = parseRunReportJson(text, filename);
      setReport(nextReport);
      setSourceName(filename);
      setActiveTab("Minted");
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    importReport(text, file.name);
    event.target.value = "";
  }

  return (
    <div className={cx("text-slate-950", embedded ? "" : "min-h-screen bg-[radial-gradient(circle_at_top_left,#ede9fe_0,#f8fafc_36%,#ffffff_72%)] px-4 py-6 sm:px-6 lg:px-8")}>
      <main className={cx("mx-auto flex w-full flex-col gap-6", embedded ? "" : "max-w-7xl")}>
        <ReportHero />
        <ImportPanel
          error={error}
          importStatus={importStatus}
          rawText={rawText}
          report={report}
          sourceName={sourceName}
          onFile={handleFile}
          onImport={() => importReport(rawText)}
          onRawText={setRawText}
          onSourceName={setSourceName}
        />

        {report ? (
          <section className="rounded-[2rem] border border-violet-100 bg-white/90 p-4 shadow-sm backdrop-blur md:p-5">
            <ReportSummary report={report} />
            <div className="mt-5 flex flex-wrap gap-2 rounded-2xl bg-slate-100 p-1">
              {REPORT_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cx(
                    "rounded-xl px-4 py-2 text-sm font-black transition",
                    activeTab === tab ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-950",
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="mt-5">
              {activeTab === "Minted" ? <MintedTable stages={report.stageSummaries} /> : null}
              {activeTab === "Transactions" ? <TransactionsTable rows={report.transactions} /> : null}
              {activeTab === "Analytics" ? <AnalyticsPanel report={report} /> : null}
            </div>
          </section>
        ) : (
          <EmptyReportState />
        )}
      </main>
    </div>
  );
}

function ReportHero() {
  return (
    <header className="overflow-hidden rounded-[2rem] border border-violet-100 bg-white/88 p-5 shadow-sm backdrop-blur-xl md:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.32em] text-violet-600">CLI bridge</p>
          <h1 className="mt-3 max-w-4xl text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
            Import a local CLI run report and review real mint results.
          </h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-500 sm:text-base">
            The viewer reads tx hashes, receipts, wallet rows, and RPC outcomes from a JSON file produced by the local CLI. It never signs,
            broadcasts, or stores private keys.
          </p>
        </div>
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 lg:w-80">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-600">Safe boundary</p>
          <p className="mt-2 leading-6">Import tx hashes and receipts only. Secret-like fields or raw signed transactions are rejected before rendering.</p>
        </div>
      </div>
    </header>
  );
}

function ImportPanel({
  error,
  importStatus,
  rawText,
  report,
  sourceName,
  onFile,
  onImport,
  onRawText,
  onSourceName,
}: {
  error: string | null;
  importStatus: string;
  rawText: string;
  report: NormalizedRunReport | null;
  sourceName: string;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onImport: () => void;
  onRawText: (value: string) => void;
  onSourceName: (value: string) => void;
}) {
  return (
    <section className="rounded-[2rem] border border-violet-100 bg-white/90 p-4 shadow-sm backdrop-blur md:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex-1">
          <p className="text-xs font-black uppercase tracking-[0.26em] text-violet-600">Run-report import</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">Load JSON from local CLI output</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
            Supports transaction arrays named <code>transactions</code>, <code>results</code>, <code>mints</code>, plus nested <code>wallets[].transactions</code> or <code>stages[].transactions</code>.
          </p>
        </div>
        <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm font-black text-violet-700">
          {importStatus}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="grid gap-3">
          <label className="flex flex-col gap-2 text-xs font-black uppercase tracking-[0.2em] text-slate-500">
            Report file
            <input
              type="file"
              accept="application/json,.json"
              onChange={onFile}
              className="rounded-2xl border border-violet-100 bg-white px-4 py-3 text-sm font-bold normal-case tracking-normal text-slate-600 shadow-sm file:mr-4 file:rounded-full file:border-0 file:bg-violet-600 file:px-4 file:py-2 file:text-sm file:font-black file:text-white"
            />
          </label>
          <label className="flex flex-col gap-2 text-xs font-black uppercase tracking-[0.2em] text-slate-500">
            Source label
            <input
              value={sourceName}
              onChange={(event) => onSourceName(event.target.value)}
              className="h-12 rounded-2xl border border-violet-100 bg-white/90 px-4 text-sm font-bold normal-case tracking-normal text-slate-950 outline-none shadow-sm focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
            />
          </label>
          <button
            type="button"
            onClick={onImport}
            disabled={rawText.trim().length === 0}
            className="h-12 rounded-2xl bg-violet-600 px-6 font-black text-white shadow-[0_16px_36px_rgba(124,58,237,0.24)] transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Import pasted JSON
          </button>
          {report ? <p className="text-sm font-bold text-emerald-700">Imported {report.collection.name} on {report.chain.name}.</p> : null}
          {error ? <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}
        </div>
        <label className="flex flex-col gap-2 text-xs font-black uppercase tracking-[0.2em] text-slate-500">
          Paste JSON
          <textarea
            value={rawText}
            onChange={(event) => onRawText(event.target.value)}
            placeholder="Paste the run-report JSON here, or choose a file."
            className="min-h-64 rounded-3xl border border-violet-100 bg-slate-950 p-4 font-mono text-xs font-semibold normal-case tracking-normal text-violet-50 outline-none shadow-sm placeholder:text-slate-500 focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
            spellCheck={false}
          />
        </label>
      </div>
    </section>
  );
}

function ReportSummary({ report }: { report: NormalizedRunReport }) {
  const { analytics } = report;
  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.26em] text-violet-600">{report.schemaVersion}</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">{report.collection.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.12em] text-violet-700">
            <span className="rounded-full bg-violet-50 px-3 py-1">{report.chain.name}</span>
            <span className="rounded-full bg-violet-50 px-3 py-1">Imported {formatDate(report.importedAt)}</span>
            {report.generatedAt ? <span className="rounded-full bg-violet-50 px-3 py-1">Generated {formatDate(report.generatedAt)}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {report.collection.openseaUrl ? <OutboundLink href={report.collection.openseaUrl}>OpenSea</OutboundLink> : null}
          {report.collection.explorerUrl ? <OutboundLink href={report.collection.explorerUrl}>Contract</OutboundLink> : null}
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Minted" value={analytics.mintedQuantity.toLocaleString()} detail="confirmed quantity" tone="emerald" />
        <MetricCard label="Confirmed" value={analytics.confirmedTransactions.toLocaleString()} detail="tx rows" tone="emerald" />
        <MetricCard label="Pending" value={analytics.pendingTransactions.toLocaleString()} detail="tx rows" tone="amber" />
        <MetricCard label="Failed" value={analytics.failedTransactions.toLocaleString()} detail="tx rows" tone="red" />
        <MetricCard label="Gas used" value={analytics.totalGasUsed ? analytics.totalGasUsed.toLocaleString() : "—"} detail="receipt gas" tone="slate" />
      </div>
    </div>
  );
}

function MintedTable({ stages }: { stages: RunStageSummary[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-violet-100">
      <div className="grid grid-cols-5 bg-violet-50 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-violet-700">
        <span className="col-span-2">Stage</span>
        <span>Minted</span>
        <span>Tx mix</span>
        <span>Status</span>
      </div>
      <div className="divide-y divide-violet-100 bg-white">
        {stages.map((stage) => (
          <div key={stage.stageId} className="grid grid-cols-5 gap-3 px-4 py-4 text-sm font-semibold text-slate-600">
            <div className="col-span-2 min-w-0">
              <p className="truncate font-black text-slate-950">{stage.stageLabel}</p>
              <p className="font-mono text-xs text-slate-400">{stage.stageId}</p>
            </div>
            <p className="font-black text-slate-950">{stage.confirmedMints}</p>
            <p>{stage.confirmedTx}✓ / {stage.pendingTx}… / {stage.failedTx}✕</p>
            <StatusBadge status={stage.failedTx > 0 ? "failed" : stage.pendingTx > 0 ? "pending" : "confirmed"} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TransactionsTable({ rows }: { rows: NormalizedRunTransaction[] }) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-violet-100 bg-white">
      <table className="min-w-[980px] w-full text-left text-sm">
        <thead className="bg-violet-50 text-xs font-black uppercase tracking-[0.16em] text-violet-700">
          <tr>
            <th className="px-4 py-3">Wallet</th>
            <th className="px-4 py-3">Stage</th>
            <th className="px-4 py-3">Qty</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Tx hash</th>
            <th className="px-4 py-3">Receipt</th>
            <th className="px-4 py-3">Error / RPC</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-violet-100">
          {rows.map((row) => (
            <tr key={row.id} className="align-top font-semibold text-slate-600">
              <td className="px-4 py-4">
                <p className="font-black text-slate-950">{row.walletAlias}</p>
                {row.walletAddress ? <p className="mt-1 font-mono text-xs text-slate-400">{shorten(row.walletAddress)}</p> : null}
              </td>
              <td className="px-4 py-4">
                <p className="font-black text-slate-950">{row.stageLabel}</p>
                <p className="font-mono text-xs text-slate-400">{row.stageId}</p>
              </td>
              <td className="px-4 py-4 font-black text-slate-950">{row.quantity}</td>
              <td className="px-4 py-4"><StatusBadge status={row.status} /></td>
              <td className="px-4 py-4">
                {row.txHash ? (
                  row.explorerUrl ? <a href={row.explorerUrl} target="_blank" rel="noreferrer" className="font-mono text-xs font-black text-violet-700 underline decoration-violet-200 underline-offset-4 hover:text-violet-500">{shorten(row.txHash, 10)}</a> : <span className="font-mono text-xs">{shorten(row.txHash, 10)}</span>
                ) : (
                  <span className="text-slate-400">No tx hash</span>
                )}
              </td>
              <td className="px-4 py-4">
                <p>{row.blockNumber ? `Block ${row.blockNumber.toLocaleString()}` : "—"}</p>
                <p className="mt-1 text-xs text-slate-400">{row.gasUsed ? `${row.gasUsed.toLocaleString()} gas` : "gas unavailable"}</p>
              </td>
              <td className="max-w-xs px-4 py-4">
                {row.error ? <p className="text-red-700">{row.error}</p> : <p className="text-slate-400">—</p>}
                {row.rpcLabels.length > 0 ? <p className="mt-1 text-xs text-slate-400">RPC: {row.rpcLabels.join(", ")}</p> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsPanel({ report }: { report: NormalizedRunReport }) {
  const { analytics } = report;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
      <section className="grid gap-3 sm:grid-cols-2">
        <MetricCard label="Total tx" value={analytics.totalTransactions.toLocaleString()} detail="all rows" tone="slate" />
        <MetricCard label="Total quantity" value={analytics.totalQuantity.toLocaleString()} detail="all statuses" tone="slate" />
        <MetricCard label="Confirmation" value={formatPercent(analytics.confirmationRate)} detail="confirmed / total" tone="emerald" />
        <MetricCard label="Failure" value={formatPercent(analytics.failureRate)} detail="failed / total" tone="red" />
        <MetricCard label="Unique wallets" value={analytics.uniqueWallets.toLocaleString()} detail="alias/address set" tone="violet" />
        <MetricCard label="Avg gas" value={analytics.averageGasUsed ? analytics.averageGasUsed.toLocaleString() : "—"} detail="confirmed receipts" tone="slate" />
      </section>
      <section className="rounded-3xl border border-violet-100 bg-violet-50/70 p-4">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-600">Report notes</p>
        <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600">
          <p><span className="font-black text-slate-950">Source:</span> {report.sourceName}</p>
          <p><span className="font-black text-slate-950">Chain:</span> {report.chain.name} ({report.chain.chainId})</p>
          <p><span className="font-black text-slate-950">Explorer:</span> {report.chain.explorer}</p>
          {report.warnings.length > 0 ? (
            <ul className="mt-2 list-inside list-disc space-y-1 text-amber-800">
              {report.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : (
            <p className="text-slate-400">No warnings supplied in the report.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function EmptyReportState() {
  return (
    <section className="grid gap-4 rounded-[2rem] border border-dashed border-violet-200 bg-white/65 p-8 text-slate-600 md:grid-cols-3">
      {[
        ["1", "Run CLI locally", "Signing and broadcasting stay in the terminal, never in this browser surface."],
        ["2", "Export JSON", "Save a run report with txHash, status, receipt, wallet, stage, and quantity rows."],
        ["3", "Import here", "Review Minted, Transactions, and Analytics from real results with explorer links."],
      ].map(([number, title, copy]) => (
        <div key={number} className="rounded-3xl border border-violet-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-black text-violet-600">{number}</p>
          <h3 className="mt-2 text-lg font-black text-slate-950">{title}</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{copy}</p>
        </div>
      ))}
    </section>
  );
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "emerald" | "amber" | "red" | "slate" | "violet" }) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  };
  return (
    <div className={cx("rounded-2xl border p-4", tones[tone])}>
      <p className="text-xs font-black uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-bold opacity-70">{detail}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: RunReportStatus }) {
  const tones: Record<RunReportStatus, string> = {
    confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
    pending: "border-amber-200 bg-amber-50 text-amber-700",
    failed: "border-red-200 bg-red-50 text-red-700",
  };
  return <span className={cx("inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.12em]", tones[status])}>{status}</span>;
}

function OutboundLink({ href, children }: { href: string; children: string }) {
  return <a href={href} target="_blank" rel="noreferrer" className="rounded-full bg-slate-950 px-4 py-2 text-sm font-black text-white hover:bg-violet-700">{children}</a>;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function shorten(value: string, size = 6) {
  if (value.length <= size * 2 + 1) return value;
  return `${value.slice(0, size)}…${value.slice(-size)}`;
}
