"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  buildMarketFighterPlan,
  defaultMarketFighterPolicy,
  MARKET_FIGHTER_PLAN_KEY,
  MARKET_FIGHTER_POLICY_KEY,
  type BotPressureInput,
  type HolderPosition,
  type MarketFighterPolicy,
  type MarketFighterSellMode,
} from "@/lib/market-fighter";
import type { LivePressureMetrics } from "@/lib/bot-pressure-live";

const FIELD = "rounded-2xl border border-violet-100 bg-white px-3 py-2 text-sm font-bold text-slate-950 outline-none shadow-sm placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100";
const POSITIONS_KEY = "compas.marketFighterPositions.v1";
const PRESSURE_KEY = "compas.marketFighterPressure.v1";

export default function MarketFighterPanel({ embedded = false }: { embedded?: boolean }) {
  const [policy, setPolicy] = useState<MarketFighterPolicy>(() => readJson<MarketFighterPolicy>(MARKET_FIGHTER_POLICY_KEY) ?? defaultMarketFighterPolicy());
  const [positions, setPositions] = useState<HolderPosition[]>(() => readJson<HolderPosition[]>(POSITIONS_KEY) ?? []);
  const [pressureInput, setPressureInput] = useState<BotPressureInput>(() => readJson<BotPressureInput>(PRESSURE_KEY) ?? { freshWalletMintPercent: 20, rapidListingPercent: 20, undercutVelocityPercent: 15, floorDepthEth: 1 });
  const [draft, setDraft] = useState<HolderPosition>({ tokenId: "", collectionAddress: "", chain: "Base", costBasisEth: 0.04, acquiredAt: new Date().toISOString(), status: "held" });
  const [liveMetrics, setLiveMetrics] = useState<LivePressureMetrics | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const plan = useMemo(() => buildMarketFighterPlan({ positions, policy, pressureInput }), [positions, policy, pressureInput]);

  async function fetchLive() {
    const target = positions[0] ?? (/^0x[a-fA-F0-9]{40}$/.test(draft.collectionAddress.trim()) ? draft : null);
    if (!target) {
      setLiveError("Add a position or paste a collection address first.");
      return;
    }
    setLiveBusy(true);
    setLiveError(null);
    try {
      const params = new URLSearchParams({ contract: target.collectionAddress, chain: target.chain.toLowerCase() });
      const response = await fetch(`/api/market/pressure?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as { ok: boolean; metrics: LivePressureMetrics };
      setLiveMetrics(body.metrics);
      if (body.metrics.error) {
        setLiveError(`Live read failed: ${body.metrics.error}`);
      } else {
        persistPressure({ ...pressureInput, freshWalletMintPercent: body.metrics.suggested.freshWalletMintPercent, suspiciousWalletCount: body.metrics.suspiciousWalletCount ?? undefined });
      }
    } catch (err) {
      setLiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setLiveBusy(false);
    }
  }

  function persistPolicy(next: MarketFighterPolicy) {
    setPolicy(next);
    writeJson(MARKET_FIGHTER_POLICY_KEY, next);
  }
  function persistPositions(next: HolderPosition[]) {
    setPositions(next);
    writeJson(POSITIONS_KEY, next);
  }
  function persistPressure(next: BotPressureInput) {
    setPressureInput(next);
    writeJson(PRESSURE_KEY, next);
  }

  function addPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^0x[a-fA-F0-9]{40}$/.test(draft.collectionAddress.trim())) return;
    if (!draft.tokenId.trim()) return;
    const next = [...positions, { ...draft, tokenId: draft.tokenId.trim(), collectionAddress: draft.collectionAddress.trim() }];
    persistPositions(next);
    setDraft({ ...draft, tokenId: "" });
  }
  function removePosition(index: number) {
    persistPositions(positions.filter((_, i) => i !== index));
  }
  function exportPlan() {
    const json = `${JSON.stringify(plan, null, 2)}\n`;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `market-fighter-plan-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
  function savePlan() {
    window.localStorage.setItem(MARKET_FIGHTER_PLAN_KEY, JSON.stringify(plan));
  }

  const pressureBand = plan.botPressure.band;
  const bandTone = pressureBand === "high" ? "bg-red-50 text-red-700 border-red-200" : pressureBand === "medium" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200";

  return (
    <section className={`rounded-[2rem] border border-red-200 bg-red-50/60 p-5 shadow-sm ${embedded ? "shadow-none" : ""}`}>
      <div className="flex flex-col gap-3 border-b border-red-200/60 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-red-700">Market fighter</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Defend holder positions on secondary.</h2>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
            Reads holder cost basis, scores bot pressure, and proposes OpenSea/Seaport listing prices that clear a target profit. Listings must be signed manually — nothing is auto-listed from this preview.
          </p>
        </div>
        <div className={`grid gap-1 rounded-2xl border px-3 py-2 text-center text-xs font-black ${bandTone}`}>
          <span>Bot pressure</span>
          <span className="text-2xl">{plan.botPressure.score}</span>
          <span className="uppercase tracking-[0.16em]">{plan.botPressure.band}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="grid gap-4">
          <PolicyCard policy={policy} setPolicy={persistPolicy} />
          <PressureCard pressureInput={pressureInput} setPressureInput={persistPressure} reasons={plan.botPressure.reasons} fetchLive={fetchLive} liveBusy={liveBusy} liveError={liveError} liveMetrics={liveMetrics} />
          <PositionForm draft={draft} setDraft={setDraft} addPosition={addPosition} />
        </div>

        <div className="rounded-3xl border border-red-200 bg-white p-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <Metric label="Positions" value={positions.length} />
            <Metric label="Suggested" value={plan.proposals.filter((p) => p.status === "suggested").length} />
            <Metric label="Blocked" value={plan.proposals.filter((p) => p.status === "blocked").length} />
            <Metric label="Mode" value={policy.sellMode} />
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {plan.checklist.map((item) => (
              <span key={item.label} className={`rounded-2xl border px-3 py-2 text-xs font-black ${item.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{item.ok ? "✓" : "○"} {item.label}</span>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {positions.length === 0 ? <p className="rounded-2xl border border-dashed border-red-200 bg-white/70 px-3 py-6 text-center text-sm font-semibold text-slate-500">Add a held position to see a listing proposal.</p> : null}
            {plan.proposals.map((proposal, index) => (
              <article key={`${proposal.collectionAddress}-${proposal.tokenId}-${index}`} className={`rounded-2xl border px-3 py-3 text-sm ${proposal.status === "suggested" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-black text-slate-950">Token #{proposal.tokenId} · {proposal.chain}</p>
                    <p className="font-mono text-xs text-slate-500">{proposal.collectionAddress}</p>
                  </div>
                  <button type="button" onClick={() => removePosition(index)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-500">Remove</button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-4 text-xs font-bold text-slate-700">
                  <span>Cost basis: {proposal.costBasisEth} ETH</span>
                  <span>List target: {proposal.suggestedListPriceEth} ETH</span>
                  <span>Net after fees: {proposal.netAfterFeesEth} ETH</span>
                  <span>Est. profit: {proposal.estimatedProfitEth} ETH</span>
                </div>
                {proposal.blockedReasons.length ? <p className="mt-2 text-xs font-bold text-amber-800">{proposal.blockedReasons.join(" · ")}</p> : <p className="mt-2 text-xs font-bold text-emerald-700">Next: manual listing review (Seaport signature required).</p>}
              </article>
            ))}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <button type="button" onClick={exportPlan} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-red-700">Export plan</button>
            <button type="button" onClick={savePlan} className="rounded-2xl bg-slate-950 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white">Save plan locally</button>
            <span className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-xs font-black text-slate-500">listing sig: manual</span>
          </div>
          <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs font-bold text-slate-600">This preview never signs a Seaport order, never posts to OpenSea, and never moves NFTs. Holder must review + sign each listing manually in the marketplace UI.</p>
        </div>
      </div>
    </section>
  );
}

function PolicyCard({ policy, setPolicy }: { policy: MarketFighterPolicy; setPolicy: (p: MarketFighterPolicy) => void }) {
  return (
    <section className="rounded-3xl border border-red-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Auto-list policy</p>
          <p className="mt-1 text-xs font-bold text-slate-600">Target profit, minimum proceeds, and holder guardrails.</p>
        </div>
        <label className="flex items-center gap-2 rounded-full bg-red-50 px-3 py-2 text-xs font-black text-red-700">
          <input type="checkbox" checked={policy.enabled} onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })} /> Enabled
        </label>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select value={policy.sellMode} onChange={(event) => setPolicy({ ...policy, sellMode: event.target.value as MarketFighterSellMode })} className={FIELD}>
          <option value="never">never</option>
          <option value="ask">ask me</option>
          <option value="manual-listing-review">manual review</option>
          <option value="auto-list-locked">auto-list locked</option>
        </select>
        <input aria-label="Target profit percent" type="number" value={policy.targetProfitPercent} onChange={(event) => setPolicy({ ...policy, targetProfitPercent: Number(event.target.value) })} className={FIELD} />
        <input aria-label="Min list ETH" type="number" step="0.001" value={policy.minListEth} onChange={(event) => setPolicy({ ...policy, minListEth: Number(event.target.value) })} className={FIELD} />
        <input aria-label="Min net proceeds ETH" type="number" step="0.001" value={policy.minNetProceedsEth} onChange={(event) => setPolicy({ ...policy, minNetProceedsEth: Number(event.target.value) })} className={FIELD} />
        <input aria-label="Marketplace fee percent" type="number" step="0.1" value={policy.marketplaceFeePercent} onChange={(event) => setPolicy({ ...policy, marketplaceFeePercent: Number(event.target.value) })} className={FIELD} />
        <input aria-label="Royalty percent" type="number" step="0.1" value={policy.royaltyPercent} onChange={(event) => setPolicy({ ...policy, royaltyPercent: Number(event.target.value) })} className={FIELD} />
        <input aria-label="Min hold minutes" type="number" value={policy.minHoldMinutes} onChange={(event) => setPolicy({ ...policy, minHoldMinutes: Number(event.target.value) })} className={FIELD} />
        <input aria-label="Bot pressure ceiling" type="number" value={policy.botPressureCeiling} onChange={(event) => setPolicy({ ...policy, botPressureCeiling: Number(event.target.value) })} className={FIELD} />
      </div>
    </section>
  );
}

function PressureCard({ fetchLive, liveBusy, liveError, liveMetrics, pressureInput, reasons, setPressureInput }: { pressureInput: BotPressureInput; reasons: string[]; setPressureInput: (p: BotPressureInput) => void; fetchLive: () => Promise<void>; liveBusy: boolean; liveError: string | null; liveMetrics: LivePressureMetrics | null }) {
  return (
    <section className="rounded-3xl border border-red-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Bot pressure inputs</p>
          <p className="mt-1 text-xs font-bold text-slate-600">Fresh-wallet mints can be read live from Blockscout transfers. Listing/undercut metrics need a marketplace events key and stay manual.</p>
        </div>
        <button type="button" onClick={fetchLive} disabled={liveBusy} className="rounded-full bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white disabled:cursor-not-allowed disabled:opacity-50">{liveBusy ? "Reading…" : "Fetch live"}</button>
      </div>
      {liveError ? <p className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{liveError}</p> : null}
      {liveMetrics && !liveMetrics.error ? (
        <div className="mt-3 grid gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800 sm:grid-cols-2">
          <span>Sample: {liveMetrics.sampleSize} transfers ({liveMetrics.windowHours ?? "?"}h)</span>
          <span>Mint share: {liveMetrics.mintSharePercent ?? "—"}%</span>
          <span>Top receiver: {liveMetrics.topReceiverSharePercent ?? "—"}%</span>
          <span>Multi-mint wallets: {liveMetrics.suspiciousWalletCount ?? "—"}</span>
          <span className="sm:col-span-2">Applied fresh-wallet estimate: {liveMetrics.suggested.freshWalletMintPercent}% · {liveMetrics.unavailable.length} metrics unavailable keyless</span>
        </div>
      ) : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input aria-label="Fresh wallet mint percent" type="number" value={pressureInput.freshWalletMintPercent} onChange={(event) => setPressureInput({ ...pressureInput, freshWalletMintPercent: Number(event.target.value) })} className={FIELD} />
        <input aria-label="Rapid mint-to-list percent" type="number" value={pressureInput.rapidListingPercent} onChange={(event) => setPressureInput({ ...pressureInput, rapidListingPercent: Number(event.target.value) })} className={FIELD} />
        <input aria-label="Undercut velocity percent" type="number" value={pressureInput.undercutVelocityPercent} onChange={(event) => setPressureInput({ ...pressureInput, undercutVelocityPercent: Number(event.target.value) })} className={FIELD} />
        <input aria-label="Floor depth ETH" type="number" step="0.001" value={pressureInput.floorDepthEth ?? 0} onChange={(event) => setPressureInput({ ...pressureInput, floorDepthEth: Number(event.target.value) })} className={FIELD} />
      </div>
      {reasons.length ? <ul className="mt-3 flex flex-wrap gap-2 text-xs font-black text-red-700">{reasons.map((reason) => <li key={reason} className="rounded-full border border-red-200 bg-red-50 px-3 py-1">{reason}</li>)}</ul> : null}
    </section>
  );
}

function PositionForm({ addPosition, draft, setDraft }: { draft: HolderPosition; addPosition: (event: FormEvent<HTMLFormElement>) => void; setDraft: (p: HolderPosition) => void }) {
  return (
    <form onSubmit={addPosition} className="rounded-3xl border border-red-200 bg-white p-4">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Add holder position</p>
      <div className="mt-3 grid gap-2">
        <input aria-label="Collection address" value={draft.collectionAddress} onChange={(event) => setDraft({ ...draft, collectionAddress: event.target.value })} placeholder="0x collection address" className={`${FIELD} font-mono normal-case tracking-normal`} />
        <div className="grid gap-2 sm:grid-cols-3">
          <input aria-label="Token id" value={draft.tokenId} onChange={(event) => setDraft({ ...draft, tokenId: event.target.value })} placeholder="tokenId" className={FIELD} />
          <select value={draft.chain} onChange={(event) => setDraft({ ...draft, chain: event.target.value })} className={FIELD}>
            <option value="Ethereum">Ethereum</option>
            <option value="Base">Base</option>
            <option value="Robinhood">Robinhood</option>
          </select>
          <input aria-label="Cost basis ETH" type="number" step="0.001" value={draft.costBasisEth} onChange={(event) => setDraft({ ...draft, costBasisEth: Number(event.target.value) })} className={FIELD} />
        </div>
        <button type="submit" className="rounded-2xl bg-red-600 px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-white">Add position</button>
      </div>
    </form>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border border-red-100 bg-red-50/60 p-3"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</p><p className="mt-1 text-sm font-black text-slate-950">{value}</p></div>;
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}
