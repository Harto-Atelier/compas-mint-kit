/**
 * Compas Market Fighter — preview-only policy engine for holder-defensive
 * secondary market planning (auto-list suggestions + bot pressure scoring).
 *
 * This module does NOT sign, list, or broadcast anything. It produces plans
 * that a holder must review and manually sign via a separate marketplace
 * signer (Seaport). Adapted from the Compas autonomy scaffold at
 * exquisite-agents-discord-passport-compas-autonomy-policy/lib/compas-autonomy.ts
 * but simplified to the ETH-decimal style used across the Compas Mint Kit.
 */

export const MARKET_FIGHTER_PLAN_KEY = "compas.marketFighterPlan.v1";
export const MARKET_FIGHTER_POLICY_KEY = "compas.marketFighterPolicy.v1";

export type MarketFighterSellMode =
  | "never"
  | "ask"
  | "manual-listing-review"
  | "auto-list-locked";

export interface MarketFighterPolicy {
  enabled: boolean;
  sellMode: MarketFighterSellMode;
  targetProfitPercent: number;
  minListEth: number;
  minNetProceedsEth: number;
  minHoldMinutes: number;
  maxListingsPerDay: number;
  marketplaceFeePercent: number;
  royaltyPercent: number;
  botPressureCeiling: number; // reject listing if pressure > this (0..100)
  marketplace: "OpenSea/Seaport";
  allowedChains: string[];
}

export interface HolderPosition {
  tokenId: string;
  collectionAddress: string;
  chain: string;
  costBasisEth: number;
  acquiredAt: string; // ISO
  status: "held" | "listed" | "sold";
}

export interface BotPressureInput {
  freshWalletMintPercent: number; // 0..100
  rapidListingPercent: number; // 0..100 minted-then-listed within N minutes
  undercutVelocityPercent: number; // 0..100 how fast floor drops
  floorDepthEth?: number; // total ETH resting on floor (>0 = healthier)
  suspiciousWalletCount?: number; // absolute count for context only
}

export interface BotPressureScore {
  score: number; // 0..100
  band: "low" | "medium" | "high";
  reasons: string[];
}

export interface ListingProposal {
  status: "suggested" | "blocked";
  tokenId: string;
  collectionAddress: string;
  chain: string;
  costBasisEth: number;
  targetProfitPercent: number;
  estimatedFeePercent: number;
  suggestedListPriceEth: number;
  minNetProceedsEth: number;
  netAfterFeesEth: number;
  estimatedProfitEth: number;
  marketplace: "OpenSea/Seaport";
  nextStep: "manual-listing-review" | "hold";
  blockedReasons: string[];
}

export interface MarketFighterPlan {
  schemaVersion: "compas-market-fighter-plan.v1";
  generatedAt: string;
  mode: "preview-only";
  safety: {
    previewOnly: true;
    listingSignature: false;
    autoListing: false;
    custody: false;
    requiresManualListingSignature: true;
  };
  policy: MarketFighterPolicy;
  botPressure: BotPressureScore;
  proposals: ListingProposal[];
  checklist: { label: string; ok: boolean }[];
  blockedReasons: string[];
}

export function defaultMarketFighterPolicy(): MarketFighterPolicy {
  return {
    enabled: true,
    sellMode: "manual-listing-review",
    targetProfitPercent: 25,
    minListEth: 0.05,
    minNetProceedsEth: 0.04,
    minHoldMinutes: 5,
    maxListingsPerDay: 10,
    marketplaceFeePercent: 2.5,
    royaltyPercent: 5,
    botPressureCeiling: 70,
    marketplace: "OpenSea/Seaport",
    allowedChains: ["Ethereum", "Base"],
  };
}

export function computeBotPressure(input: BotPressureInput): BotPressureScore {
  const fresh = clamp01Pct(input.freshWalletMintPercent);
  const rapid = clamp01Pct(input.rapidListingPercent);
  const undercut = clamp01Pct(input.undercutVelocityPercent);
  const raw = fresh * 0.35 + rapid * 0.35 + undercut * 0.3;
  const floorPenalty = input.floorDepthEth !== undefined && input.floorDepthEth < 0.5 ? 10 : 0;
  const score = Math.round(Math.min(100, raw + floorPenalty));
  const band: BotPressureScore["band"] = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  const reasons: string[] = [];
  if (fresh >= 40) reasons.push(`fresh-wallet mints ${fresh.toFixed(0)}%`);
  if (rapid >= 40) reasons.push(`rapid mint-to-list ${rapid.toFixed(0)}%`);
  if (undercut >= 40) reasons.push(`undercut velocity ${undercut.toFixed(0)}%`);
  if (floorPenalty > 0) reasons.push("thin floor depth");
  if (input.suspiciousWalletCount && input.suspiciousWalletCount > 25) reasons.push(`${input.suspiciousWalletCount} suspicious wallets`);
  return { score, band, reasons };
}

export function buildListingProposal(input: { position: HolderPosition; policy: MarketFighterPolicy; botPressure: BotPressureScore; now?: Date }): ListingProposal {
  const now = input.now ?? new Date();
  const policy = input.policy;
  const position = input.position;
  const fees = clampNumber(policy.marketplaceFeePercent + policy.royaltyPercent, 0, 50);
  const feeMultiplier = 1 - fees / 100;
  const targetNet = position.costBasisEth * (1 + clampNumber(policy.targetProfitPercent, 0, 10_000) / 100);
  const priceForProfit = feeMultiplier > 0 ? targetNet / feeMultiplier : targetNet;
  const suggestedListPriceEth = roundEth(Math.max(priceForProfit, policy.minListEth));
  const netAfterFeesEth = roundEth(suggestedListPriceEth * feeMultiplier);
  const estimatedProfitEth = roundEth(netAfterFeesEth - position.costBasisEth);

  const acquiredMs = Date.parse(position.acquiredAt);
  const heldMinutes = Number.isFinite(acquiredMs) ? Math.max(0, (now.getTime() - acquiredMs) / 60_000) : 0;

  const blockedReasons: string[] = [];
  if (!policy.enabled) blockedReasons.push("policy disabled");
  if (policy.sellMode === "never") blockedReasons.push("sell mode = never");
  if (policy.sellMode === "auto-list-locked") blockedReasons.push("auto-list is locked in preview");
  if (!policy.allowedChains.includes(position.chain)) blockedReasons.push(`chain ${position.chain} not allowed`);
  if (position.status !== "held") blockedReasons.push(`position status ${position.status}`);
  if (heldMinutes < policy.minHoldMinutes) blockedReasons.push(`min hold ${policy.minHoldMinutes}m not reached`);
  if (netAfterFeesEth < policy.minNetProceedsEth) blockedReasons.push(`net proceeds below min ${policy.minNetProceedsEth} ETH`);
  if (input.botPressure.score > policy.botPressureCeiling) blockedReasons.push(`bot pressure ${input.botPressure.score} > ceiling ${policy.botPressureCeiling}`);

  return {
    status: blockedReasons.length ? "blocked" : "suggested",
    tokenId: position.tokenId,
    collectionAddress: position.collectionAddress,
    chain: position.chain,
    costBasisEth: roundEth(position.costBasisEth),
    targetProfitPercent: policy.targetProfitPercent,
    estimatedFeePercent: fees,
    suggestedListPriceEth,
    minNetProceedsEth: policy.minNetProceedsEth,
    netAfterFeesEth,
    estimatedProfitEth,
    marketplace: "OpenSea/Seaport",
    nextStep: blockedReasons.length ? "hold" : "manual-listing-review",
    blockedReasons,
  };
}

export function buildMarketFighterPlan(input: { positions: HolderPosition[]; policy: MarketFighterPolicy; pressureInput: BotPressureInput; now?: Date }): MarketFighterPlan {
  const now = input.now ?? new Date();
  const botPressure = computeBotPressure(input.pressureInput);
  const proposals = input.positions.map((position) => buildListingProposal({ position, policy: input.policy, botPressure, now }));
  const suggestedCount = proposals.filter((proposal) => proposal.status === "suggested").length;
  const checklist = [
    { label: "Policy enabled", ok: input.policy.enabled },
    { label: "Sell mode is review/manual only", ok: input.policy.sellMode === "manual-listing-review" || input.policy.sellMode === "ask" },
    { label: "Bot pressure within ceiling", ok: botPressure.score <= input.policy.botPressureCeiling },
    { label: "At least one listable position", ok: suggestedCount > 0 },
    { label: "Marketplace fee + royalty declared", ok: input.policy.marketplaceFeePercent + input.policy.royaltyPercent >= 0 },
    { label: "Listing signature stays manual", ok: input.policy.sellMode !== "auto-list-locked" },
  ];
  const blockedReasons = checklist.filter((item) => !item.ok).map((item) => item.label);
  return {
    schemaVersion: "compas-market-fighter-plan.v1",
    generatedAt: now.toISOString(),
    mode: "preview-only",
    safety: { previewOnly: true, listingSignature: false, autoListing: false, custody: false, requiresManualListingSignature: true },
    policy: input.policy,
    botPressure,
    proposals,
    checklist,
    blockedReasons,
  };
}

function clamp01Pct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundEth(value: number): number {
  return Number(value.toFixed(6));
}
