"use client";

import { type ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
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
import {
  buildFighterPlan,
  defaultFighterPolicy,
  COMPAS_MARKET_FIGHTER_POLICY_KEY,
  type BotPressureSnapshot,
  type FighterHolding,
  type FighterPolicy,
} from "@/lib/compas-market-fighter";
import { fetchSignedGateSession, type CompasGateSession } from "@/lib/compas-gate";
import { extractCostBasisFromBrowserReport, rejectSecretShapedReport, summarizeCostBasis, type CostBasisSummary } from "@/lib/cost-basis";
import { buildSeaportListingDraft } from "@/lib/seaport-listing-draft";

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
  const [holderSession, setHolderSession] = useState<CompasGateSession | null>(null);
  const [holdingsBusy, setHoldingsBusy] = useState(false);
  const [holdingsError, setHoldingsError] = useState<string | null>(null);
  const [costSummary, setCostSummary] = useState<CostBasisSummary | null>(null);

  const plan = useMemo(() => buildMarketFighterPlan({ positions, policy, pressureInput }), [positions, policy, pressureInput]);

  useEffect(() => {
    fetchSignedGateSession().then(setHolderSession).catch(() => setHolderSession(null));
  }, []);

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

  async function importCostBasis(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      rejectSecretShapedReport(text);
      const entries = extractCostBasisFromBrowserReport(JSON.parse(text));
      setCostSummary(summarizeCostBasis(entries));
    } catch (err) {
      setHoldingsError(err instanceof Error ? err.message : String(err));
    } finally {
      event.target.value = "";
    }
  }

  async function detectHolderPositions() {
    const wallet = holderSession?.address;
    const target = positions[0] ?? (/^0x[a-fA-F0-9]{40}$/.test(draft.collectionAddress.trim()) ? draft : null);
    if (!wallet) {
      setHoldingsError("Connect/sign as a Compas holder first.");
      return;
    }
    if (!target) {
      setHoldingsError("Add or paste a collection address first.");
      return;
    }
    setHoldingsBusy(true);
    setHoldingsError(null);
    try {
      const params = new URLSearchParams({ wallet, contract: target.collectionAddress, chain: target.chain.toLowerCase() });
      const response = await fetch(`/api/market/holdings?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as { ok: boolean; result: { tokenIds: string[]; error?: string; sampleTruncated: boolean } };
      if (body.result.error) throw new Error(body.result.error);
      const cost = costSummary?.perRecipient[wallet] ?? draft.costBasisEth;
      const perTokenCost = body.result.tokenIds.length > 0 ? Number((cost / body.result.tokenIds.length).toFixed(6)) : draft.costBasisEth;
      const next = body.result.tokenIds.map((tokenId) => ({ tokenId, collectionAddress: target.collectionAddress, chain: target.chain, costBasisEth: perTokenCost, acquiredAt: new Date().toISOString(), status: "held" as const }));
      persistPositions(next);
      if (body.result.sampleTruncated) setHoldingsError("Holdings sample truncated by Blockscout page cap; export/review before listing.");
    } catch (err) {
      setHoldingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setHoldingsBusy(false);
    }
  }

  function exportListingDraft(index: number) {
    const proposal = plan.proposals[index];
    if (!proposal || !holderSession) return;
    const draft = buildSeaportListingDraft({ proposal, offererAddress: holderSession.address, durationHours: 24 });
    const json = `${JSON.stringify(draft, null, 2)}\n`;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `seaport-listing-draft-${proposal.tokenId}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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

      <DefensivePlannerSection positions={positions} />

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="grid gap-4">
          <PolicyCard policy={policy} setPolicy={persistPolicy} />
          <PressureCard pressureInput={pressureInput} setPressureInput={persistPressure} reasons={plan.botPressure.reasons} fetchLive={fetchLive} liveBusy={liveBusy} liveError={liveError} liveMetrics={liveMetrics} />
          <HoldingsCard costSummary={costSummary} detectHolderPositions={detectHolderPositions} holdingsBusy={holdingsBusy} holdingsError={holdingsError} holderAddress={holderSession?.address} importCostBasis={importCostBasis} />
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
                {proposal.blockedReasons.length ? <p className="mt-2 text-xs font-bold text-amber-800">{proposal.blockedReasons.join(" · ")}</p> : <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs font-bold text-emerald-700">Next: manual listing review (Seaport signature required).</p><button type="button" onClick={() => exportListingDraft(index)} disabled={!holderSession} className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50">Export Seaport draft</button></div>}
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

function HoldingsCard({ costSummary, detectHolderPositions, holdingsBusy, holdingsError, holderAddress, importCostBasis }: { costSummary: CostBasisSummary | null; detectHolderPositions: () => Promise<void>; holdingsBusy: boolean; holdingsError: string | null; holderAddress?: string; importCostBasis: (event: ChangeEvent<HTMLInputElement>) => Promise<void> }) {
  return (
    <section className="rounded-3xl border border-indigo-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">Holder positions + cost basis</p>
          <p className="mt-1 text-xs font-bold text-slate-600">Detect tokenIds for the connected holder via keyless Blockscout. Import a signer report to allocate mint cost basis.</p>
        </div>
        <button type="button" onClick={detectHolderPositions} disabled={holdingsBusy} className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white disabled:cursor-not-allowed disabled:opacity-50">{holdingsBusy ? "Detecting…" : "Auto-detect"}</button>
      </div>
      <div className="mt-3 grid gap-2 text-xs font-bold text-slate-700 sm:grid-cols-2">
        <span className="rounded-2xl bg-indigo-50 px-3 py-2 text-indigo-700">Holder: {holderAddress ? `${holderAddress.slice(0, 6)}…${holderAddress.slice(-4)}` : "connect first"}</span>
        <label className="rounded-2xl border border-dashed border-indigo-200 px-3 py-2 text-indigo-700">
          Import run report JSON
          <input type="file" accept="application/json,.json" onChange={importCostBasis} className="sr-only" />
        </label>
      </div>
      {costSummary ? <p className="mt-2 rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">Cost basis loaded: {costSummary.count} tx · {costSummary.totalSpentEth} ETH total.</p> : null}
      {holdingsError ? <p className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{holdingsError}</p> : null}
      <p className="mt-2 text-[11px] font-bold text-slate-500">Preview-only: this reads public NFT instances, never signs, never lists, never custodies.</p>
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

type PressureApiResponse = {
  ok: boolean;
  source?: { kind: string; slug: string; status: "live" | "unavailable" | "not-configured"; error?: string; fetchedAt: string; eventCount: number };
  pressure?: BotPressureSnapshot;
};

function DefensivePlannerSection({ positions }: { positions: HolderPosition[] }) {
  const [fighterPolicy, setFighterPolicy] = useState<FighterPolicy>(() => readJson<FighterPolicy>(COMPAS_MARKET_FIGHTER_POLICY_KEY) ?? defaultFighterPolicy());
  const [slug, setSlug] = useState("");
  const [floorEthInput, setFloorEthInput] = useState("");
  const [pressureBusy, setPressureBusy] = useState(false);
  const [pressureResponse, setPressureResponse] = useState<PressureApiResponse | null>(null);
  const [pressureError, setPressureError] = useState<string | null>(null);

  const holdings: FighterHolding[] = useMemo(
    () => positions.map((position) => ({ tokenId: position.tokenId, mintCostEth: position.costBasisEth, activeListing: position.status === "listed" })),
    [positions],
  );

  const pressure = pressureResponse?.pressure ?? null;
  const fighterPlan = useMemo(() => (pressure ? buildFighterPlan(fighterPolicy, pressure, holdings) : null), [fighterPolicy, pressure, holdings]);

  function persistFighterPolicy(next: FighterPolicy) {
    setFighterPolicy(next);
    writeJson(COMPAS_MARKET_FIGHTER_POLICY_KEY, next);
  }

  async function checkPressure() {
    const trimmed = slug.trim().toLowerCase();
    if (!trimmed) {
      setPressureError("Add the OpenSea collection slug first.");
      return;
    }
    setPressureBusy(true);
    setPressureError(null);
    try {
      const params = new URLSearchParams({ slug: trimmed });
      const floor = Number(floorEthInput);
      if (Number.isFinite(floor) && floor > 0) params.set("floorEth", String(floor));
      const response = await fetch(`/api/market/pressure?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as PressureApiResponse;
      setPressureResponse(body);
      if (body.source && body.source.status !== "live") {
        setPressureError(`OpenSea events unavailable${body.source.error ? `: ${body.source.error}` : ""}. No numbers invented — try again later.`);
      }
    } catch (err) {
      setPressureError(err instanceof Error ? err.message : String(err));
    } finally {
      setPressureBusy(false);
    }
  }

  const level = pressure?.pressureLevel ?? null;
  const levelTone = level === "bot-storm" ? "border-red-300 bg-red-100 text-red-800" : level === "active" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-700";
  const levelLabel = level === "bot-storm" ? "Bot storm" : level === "active" ? "Active" : level === "calm" ? "Calm" : "No read yet";

  return (
    <section className="mt-5 rounded-3xl border border-red-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">Defensive planner · OpenSea events</p>
          <p className="mt-1 max-w-xl text-xs font-bold text-slate-600">Reads live collection listings/sales, rates bot pressure, and prices defensive listings from your positions. Nothing is signed here.</p>
        </div>
        <span className={`rounded-2xl border px-3 py-2 text-center text-xs font-black uppercase tracking-[0.14em] ${levelTone}`}>{levelLabel}</span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px_auto]">
        <input aria-label="OpenSea collection slug" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="opensea collection slug" className={`${FIELD} normal-case tracking-normal`} />
        <input aria-label="Floor ETH" type="number" step="0.001" value={floorEthInput} onChange={(event) => setFloorEthInput(event.target.value)} placeholder="floor ETH" className={FIELD} />
        <button type="button" onClick={checkPressure} disabled={pressureBusy} className="rounded-2xl bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white disabled:cursor-not-allowed disabled:opacity-50">{pressureBusy ? "Checking…" : "Check pressure"}</button>
      </div>

      {pressureError ? <p className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{pressureError}</p> : null}

      {pressure && pressureResponse?.source?.status === "live" ? (
        <div className="mt-3 grid gap-2 text-xs font-bold text-slate-700 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Listings 1h" value={pressure.listingsLast1h} />
          <Metric label="Listings 24h" value={pressure.listingsLast24h} />
          <Metric label="Listers est." value={pressure.uniqueListers24hEstimate} />
          <Metric label="Sales 24h" value={pressure.salesLast24h} />
          <Metric label="Floor" value={pressure.floorEth !== null ? `${pressure.floorEth} ETH` : "unknown"} />
          <Metric label="Floor drop 24h" value={pressure.floorDropBps24h > 0 ? `${(pressure.floorDropBps24h / 100).toFixed(1)}%` : "—"} />
        </div>
      ) : null}
      {pressure && pressure.reasons.length ? <ul className="mt-2 flex flex-wrap gap-2 text-xs font-black text-red-700">{pressure.reasons.map((reason) => <li key={reason} className="rounded-full border border-red-200 bg-red-50 px-3 py-1">{reason}</li>)}</ul> : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
          Anchor
          <select value={fighterPolicy.floorAnchor} onChange={(event) => persistFighterPolicy({ ...fighterPolicy, floorAnchor: event.target.value as FighterPolicy["floorAnchor"] })} className={FIELD}>
            <option value="floor">Collection floor</option>
            <option value="trait-floor">Trait floor</option>
          </select>
        </label>
        <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
          Undercut (bps)
          <input type="number" value={fighterPolicy.undercutBps} onChange={(event) => persistFighterPolicy({ ...fighterPolicy, undercutBps: Number(event.target.value) })} className={FIELD} />
        </label>
        <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
          Min margin over cost (bps)
          <input type="number" value={fighterPolicy.minMarginBps} onChange={(event) => persistFighterPolicy({ ...fighterPolicy, minMarginBps: Number(event.target.value) })} className={FIELD} />
        </label>
        <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
          Max active listings
          <input type="number" value={fighterPolicy.maxActiveListings} onChange={(event) => persistFighterPolicy({ ...fighterPolicy, maxActiveListings: Number(event.target.value) })} className={FIELD} />
        </label>
        <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
          Cooldown (min)
          <input type="number" value={fighterPolicy.cooldownMinutes} onChange={(event) => persistFighterPolicy({ ...fighterPolicy, cooldownMinutes: Number(event.target.value) })} className={FIELD} />
        </label>
        <label className="grid gap-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
          During bot storm
          <select value={fighterPolicy.stormBehavior} onChange={(event) => persistFighterPolicy({ ...fighterPolicy, stormBehavior: event.target.value as FighterPolicy["stormBehavior"] })} className={FIELD}>
            <option value="hold">Hold (don&apos;t list)</option>
            <option value="undercut">Keep undercutting</option>
          </select>
        </label>
      </div>

      <div className="mt-4 space-y-2">
        {!pressure ? <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm font-semibold text-slate-500">Check pressure first — suggestions come from live data only.</p> : null}
        {pressure && holdings.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm font-semibold text-slate-500">No positions yet. Add or auto-detect held tokens below to get defensive prices.</p> : null}
        {fighterPlan?.suggestions.map((suggestion, index) => (
          <article key={`${suggestion.tokenId ?? "token"}-${index}`} className={`rounded-2xl border px-3 py-3 text-sm ${suggestion.blocked ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-black text-slate-950">{suggestion.tokenId ? `Token #${suggestion.tokenId}` : "Position"} · {suggestion.suggestedPriceEth} ETH</p>
              <button type="button" disabled title="Manual signing — coming after canary QA" className="cursor-not-allowed rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-400">Review &amp; sign manually</button>
            </div>
            <p className="mt-1 text-xs font-bold text-slate-600">{suggestion.rationale}</p>
            {suggestion.blockReasons.length ? <p className="mt-1 text-xs font-bold text-amber-800">Blocked: {suggestion.blockReasons.join(" · ")}</p> : null}
          </article>
        ))}
      </div>
      <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs font-bold text-slate-600">Manual signing — coming after canary QA. This planner never auto-lists, never signs Seaport orders, never touches custody.</p>
    </section>
  );
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
