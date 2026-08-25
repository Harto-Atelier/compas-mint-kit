/**
 * Compas Market Fighter — defensive listing planner + bot-pressure monitor.
 *
 * Preview-only. This module never signs, lists, broadcasts, or custodies
 * anything: it turns normalized OpenSea events (lib/opensea-events-activity)
 * plus a holder policy into suggestions that ALWAYS require a manual
 * signature. Policy shapes adapted from the Compas autonomy scaffold
 * (sell modes / take-profit / risk policies) rewritten in mint-kit style.
 */

import type { OpenSeaActivityEvent } from "./opensea-events-activity";

export const COMPAS_MARKET_FIGHTER_POLICY_KEY = "compas.marketFighter.policy.v2";
export const COMPAS_MARKET_FIGHTER_PLAN_KEY = "compas.marketFighter.plan.v2";

export type FighterFloorAnchor = "floor" | "trait-floor";
export type FighterStormBehavior = "hold" | "undercut";
export type PressureLevel = "calm" | "active" | "bot-storm";

export interface FighterPolicy {
  floorAnchor: FighterFloorAnchor;
  /** Basis points below the anchor floor for a defensive listing. */
  undercutBps: number;
  /** Minimum margin in basis points over mint cost — never list below this. */
  minMarginBps: number;
  /** Optional take-profit target in ETH (informational; surfaces in rationale). */
  takeProfitEth?: number;
  maxActiveListings: number;
  cooldownMinutes: number;
  /** What to do during a bot-storm: hold (block suggestions) or keep undercutting. */
  stormBehavior: FighterStormBehavior;
}

export interface BotPressureSnapshot {
  listingsLast1h: number;
  listingsLast24h: number;
  /** Estimated from distinct listed tokenIds — OpenSea events omit maker addresses. */
  uniqueListers24hEstimate: number;
  floorEth: number | null;
  /** Floor drop over ~24h in basis points, derived from listing prices. 0 when unknown. */
  floorDropBps24h: number;
  salesLast24h: number;
  pressureLevel: PressureLevel;
  reasons: string[];
}

export interface FighterHolding {
  tokenId?: string;
  /** Mint cost basis in ETH for this token. */
  mintCostEth: number;
  /** Already has a live listing (counts against maxActiveListings). */
  activeListing?: boolean;
  /** ISO timestamp of the last listing action, for cooldown checks. */
  lastListedAt?: string;
}

export interface ListingSuggestion {
  tokenId?: string;
  suggestedPriceEth: number;
  rationale: string;
  blocked: boolean;
  blockReasons: string[];
  requiresManualSign: true;
}

export interface FighterSafetyEnvelope {
  previewOnly: true;
  execution: "none";
  broadcast: false;
  custody: false;
  autoListing: false;
  listingSignature: false;
}

export interface FighterPlan {
  schemaVersion: "compas-market-fighter-plan.v2";
  generatedAt: string;
  mode: "preview-only";
  safety: FighterSafetyEnvelope;
  policy: FighterPolicy;
  pressure: BotPressureSnapshot;
  suggestions: ListingSuggestion[];
  blockedCount: number;
  suggestedCount: number;
}

const ONE_HOUR_S = 3600;
const TWELVE_HOURS_S = 12 * 3600;
const TWENTY_FOUR_HOURS_S = 24 * 3600;

export const FIGHTER_SAFETY_ENVELOPE: FighterSafetyEnvelope = {
  previewOnly: true,
  execution: "none",
  broadcast: false,
  custody: false,
  autoListing: false,
  listingSignature: false,
};

export function defaultFighterPolicy(): FighterPolicy {
  return {
    floorAnchor: "floor",
    undercutBps: 100,
    minMarginBps: 1500,
    maxActiveListings: 3,
    cooldownMinutes: 30,
    stormBehavior: "hold",
  };
}

/**
 * Derive bot pressure from normalized OpenSea events. Pure function.
 * Heuristics:
 *  - "bot-storm": listingsLast1h >= 10, OR floorDropBps24h >= 500 while sales are low (<= 2).
 *  - "active": listingsLast1h >= 4, listingsLast24h >= 20, or floorDropBps24h >= 200.
 *  - otherwise "calm".
 */
export function assessBotPressure(events: OpenSeaActivityEvent[], floorEth: number | null, now: Date = new Date()): BotPressureSnapshot {
  const nowS = Math.floor(now.getTime() / 1000);
  const inWindow = (event: OpenSeaActivityEvent, windowS: number) => {
    const age = nowS - event.timestamp;
    return age >= 0 && age <= windowS;
  };
  const listings24h = events.filter((event) => event.action === "list" && inWindow(event, TWENTY_FOUR_HOURS_S));
  const listingsLast1h = listings24h.filter((event) => inWindow(event, ONE_HOUR_S)).length;
  const salesLast24h = events.filter((event) => event.action === "sale" && inWindow(event, TWENTY_FOUR_HOURS_S)).length;
  const uniqueTokenIds = new Set(listings24h.map((event) => event.tokenId).filter((tokenId): tokenId is string => Boolean(tokenId)));
  const uniqueListers24hEstimate = uniqueTokenIds.size > 0 ? uniqueTokenIds.size : listings24h.length;
  const floorDropBps24h = estimateFloorDropBps(listings24h, floorEth, nowS);

  const reasons: string[] = [];
  let pressureLevel: PressureLevel = "calm";
  const stormByBurst = listingsLast1h >= 10;
  const stormByDump = floorDropBps24h >= 500 && salesLast24h <= 2;
  if (stormByBurst) reasons.push(`${listingsLast1h} listings in the last hour`);
  if (stormByDump) reasons.push(`floor down ${(floorDropBps24h / 100).toFixed(1)}% in 24h with only ${salesLast24h} sales`);
  if (stormByBurst || stormByDump) {
    pressureLevel = "bot-storm";
  } else if (listingsLast1h >= 4 || listings24h.length >= 20 || floorDropBps24h >= 200) {
    pressureLevel = "active";
    if (listingsLast1h >= 4) reasons.push(`${listingsLast1h} listings in the last hour`);
    if (listings24h.length >= 20) reasons.push(`${listings24h.length} listings in 24h`);
    if (floorDropBps24h >= 200) reasons.push(`floor down ${(floorDropBps24h / 100).toFixed(1)}% in 24h`);
  }

  return {
    listingsLast1h,
    listingsLast24h: listings24h.length,
    uniqueListers24hEstimate,
    floorEth: floorEth !== null && Number.isFinite(floorEth) && floorEth > 0 ? roundEth(floorEth) : null,
    floorDropBps24h,
    salesLast24h,
    pressureLevel,
    reasons,
  };
}

/**
 * Build a defensive listing plan. Every suggestion requires a manual signature;
 * nothing here signs or submits anything.
 */
export function buildFighterPlan(policy: FighterPolicy, pressure: BotPressureSnapshot, holdings: FighterHolding[], now: Date = new Date()): FighterPlan {
  const undercutBps = clampNumber(policy.undercutBps, 0, 9_999);
  const minMarginBps = clampNumber(policy.minMarginBps, 0, 100_000);
  const maxActive = Math.max(0, Math.floor(clampNumber(policy.maxActiveListings, 0, 1_000)));
  const cooldownMs = clampNumber(policy.cooldownMinutes, 0, 7 * 24 * 60) * 60_000;
  const floorEth = pressure.floorEth;
  let activeCount = holdings.filter((holding) => holding.activeListing).length;

  const suggestions: ListingSuggestion[] = holdings
    .filter((holding) => !holding.activeListing)
    .map((holding) => {
      const cost = clampNumber(holding.mintCostEth, 0, 100_000);
      const marginPriceEth = roundEth(cost * (1 + minMarginBps / 10_000));
      const undercutPriceEth = floorEth !== null ? roundEth(floorEth * (1 - undercutBps / 10_000)) : null;
      const suggestedPriceEth = undercutPriceEth !== null ? Math.max(undercutPriceEth, marginPriceEth) : marginPriceEth;

      const blockReasons: string[] = [];
      if (floorEth === null) {
        blockReasons.push("floor-unknown");
      } else if (undercutPriceEth !== null && undercutPriceEth < marginPriceEth) {
        blockReasons.push("undercut-price-below-min-margin");
      }
      if (pressure.pressureLevel === "bot-storm" && policy.stormBehavior === "hold") {
        blockReasons.push("bot-storm-hold");
      }
      if (holding.lastListedAt) {
        const lastMs = Date.parse(holding.lastListedAt);
        if (Number.isFinite(lastMs) && now.getTime() - lastMs < cooldownMs) blockReasons.push("cooldown-active");
      }
      if (blockReasons.length === 0) {
        if (activeCount >= maxActive) {
          blockReasons.push("max-active-listings-reached");
        } else {
          activeCount += 1;
        }
      }

      const anchorNote = policy.floorAnchor === "trait-floor" ? "trait floor" : "collection floor";
      const rationaleParts: string[] = [];
      if (floorEth === null) {
        rationaleParts.push("Floor unknown — cannot anchor a defensive price.");
      } else if (suggestedPriceEth === marginPriceEth && undercutPriceEth !== null && undercutPriceEth < marginPriceEth) {
        rationaleParts.push(`Min margin ${(minMarginBps / 100).toFixed(1)}% over cost (${marginPriceEth} ETH) wins over ${anchorNote} undercut (${undercutPriceEth} ETH).`);
      } else {
        rationaleParts.push(`Undercut ${anchorNote} ${floorEth} ETH by ${(undercutBps / 100).toFixed(2)}% → ${suggestedPriceEth} ETH, above min margin.`);
      }
      if (policy.takeProfitEth !== undefined && floorEth !== null && floorEth >= policy.takeProfitEth) {
        rationaleParts.push(`Floor is at/above take-profit target ${policy.takeProfitEth} ETH.`);
      }
      rationaleParts.push("Manual review + signature required.");

      return {
        ...(holding.tokenId !== undefined ? { tokenId: holding.tokenId } : {}),
        suggestedPriceEth: roundEth(suggestedPriceEth),
        rationale: rationaleParts.join(" "),
        blocked: blockReasons.length > 0,
        blockReasons,
        requiresManualSign: true as const,
      };
    });

  return {
    schemaVersion: "compas-market-fighter-plan.v2",
    generatedAt: now.toISOString(),
    mode: "preview-only",
    safety: { ...FIGHTER_SAFETY_ENVELOPE },
    policy,
    pressure,
    suggestions,
    blockedCount: suggestions.filter((suggestion) => suggestion.blocked).length,
    suggestedCount: suggestions.filter((suggestion) => !suggestion.blocked).length,
  };
}

/**
 * Estimate 24h floor drop in bps by comparing the lowest listing price in the
 * older half of the window (12–24h ago) against the newer half (0–12h, falling
 * back to the live floor). Returns 0 when there is not enough data — never a
 * fabricated number.
 */
function estimateFloorDropBps(listings24h: OpenSeaActivityEvent[], floorEth: number | null, nowS: number): number {
  const priced = listings24h.filter((event) => typeof event.priceEth === "number" && Number.isFinite(event.priceEth) && (event.priceEth as number) > 0);
  const older = priced.filter((event) => nowS - event.timestamp > TWELVE_HOURS_S);
  const newer = priced.filter((event) => nowS - event.timestamp <= TWELVE_HOURS_S);
  const olderFloor = minPrice(older);
  const newerFloorCandidates = [minPrice(newer), floorEth !== null && Number.isFinite(floorEth) && floorEth > 0 ? floorEth : null].filter((value): value is number => value !== null);
  const newerFloor = newerFloorCandidates.length ? Math.min(...newerFloorCandidates) : null;
  if (olderFloor === null || newerFloor === null || olderFloor <= 0) return 0;
  const dropBps = ((olderFloor - newerFloor) / olderFloor) * 10_000;
  return dropBps > 0 ? Math.round(dropBps) : 0;
}

function minPrice(events: OpenSeaActivityEvent[]): number | null {
  const prices = events.map((event) => event.priceEth).filter((price): price is number => typeof price === "number" && Number.isFinite(price) && price > 0);
  return prices.length ? Math.min(...prices) : null;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundEth(value: number): number {
  return Number(value.toFixed(6));
}
