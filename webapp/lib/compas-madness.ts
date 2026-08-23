import type { CompasAutopilotProposal } from "./compas-autopilot";

export const COMPAS_MADNESS_PLAN_KEY = "compas.madnessPlan.v1";

export interface CompasMadnessPolicy {
  enabled: boolean;
  quantity: number;
  maxTotalEth: number;
  maxGasEth: number;
  targetProfitPercent: number;
  minimumListingEth: number;
  marketplaceFeePercent: number;
  royaltyPercent: number;
  mode: "preview" | "madness-canary" | "full-madness-locked";
  listingMode: "suggest-only" | "manual-listing-review" | "auto-list-locked";
}

export interface CompasMadnessPlan {
  schemaVersion: "compas-madness-plan.v1";
  generatedAt: string;
  mode: "preview-only";
  safety: {
    previewOnly: true;
    mintBroadcast: false;
    listingSignature: false;
    autoListing: false;
    custody: false;
    requiresManualMintBroadcast: true;
    requiresManualListingSignature: true;
  };
  sourceProposal: Pick<CompasAutopilotProposal, "schemaVersion" | "candidate" | "recipient" | "blockedReasons">;
  policy: CompasMadnessPolicy;
  mintPlan: {
    requestedQuantity: number;
    executableQuantity: number;
    maxTotalEth: number;
    maxGasEth: number;
    recipientAddress?: string;
    route: "compas-holder-seadrop-public";
  };
  listingPlan: {
    status: "suggested" | "blocked";
    costBasisEth: number;
    targetProfitPercent: number;
    estimatedFeePercent: number;
    suggestedListPriceEth: number;
    minimumListPriceEth: number;
    netAfterFeesEth: number;
    estimatedProfitEth: number;
    marketplace: "OpenSea/Seaport";
    nextStep: "manual-listing-review" | "wait-for-mint";
  };
  checklist: { label: string; ok: boolean }[];
  blockedReasons: string[];
}

export function defaultCompasMadnessPolicy(): CompasMadnessPolicy {
  return {
    enabled: true,
    quantity: 3,
    maxTotalEth: 0.15,
    maxGasEth: 0.015,
    targetProfitPercent: 25,
    minimumListingEth: 0.05,
    marketplaceFeePercent: 2.5,
    royaltyPercent: 5,
    mode: "preview",
    listingMode: "suggest-only",
  };
}

export function buildCompasMadnessPlan(input: { proposal: CompasAutopilotProposal | null; policy: CompasMadnessPolicy; now?: Date }): CompasMadnessPlan | null {
  if (!input.policy.enabled || !input.proposal) return null;
  const proposal = input.proposal;
  const requestedQuantity = clampInt(input.policy.quantity, 1, 100);
  const executableQuantity = input.policy.mode === "madness-canary" ? 1 : requestedQuantity;
  const fees = clampNumber(input.policy.marketplaceFeePercent + input.policy.royaltyPercent, 0, 50);
  const maxTotalEth = clampNumber(input.policy.maxTotalEth, 0, 10_000);
  const maxGasEth = clampNumber(input.policy.maxGasEth, 0, maxTotalEth);
  const costBasisEth = roundEth((maxTotalEth + maxGasEth) / Math.max(1, executableQuantity));
  const targetNetEth = costBasisEth * (1 + clampNumber(input.policy.targetProfitPercent, 0, 10_000) / 100);
  const feeMultiplier = 1 - fees / 100;
  const priceForProfit = feeMultiplier > 0 ? targetNetEth / feeMultiplier : targetNetEth;
  const suggestedListPriceEth = roundEth(Math.max(priceForProfit, input.policy.minimumListingEth));
  const netAfterFeesEth = roundEth(suggestedListPriceEth * feeMultiplier);
  const estimatedProfitEth = roundEth(netAfterFeesEth - costBasisEth);
  const checklist = [
    { label: "Autopilot proposal ready", ok: proposal.proposedPlan.nextStep === "simulate-in-browser" },
    { label: "Compas holder recipient", ok: proposal.recipient.status === "resolved" && Boolean(proposal.recipient.address) },
    { label: "SeaDrop public only", ok: proposal.checklist.some((item) => item.label === "Executable SeaDrop public stage" && item.ok) },
    { label: "Quantity within madness bounds", ok: requestedQuantity >= 1 && requestedQuantity <= 100 },
    { label: "Max spend set", ok: maxTotalEth > 0 },
    { label: "Listing is suggest/manual only", ok: input.policy.listingMode !== "auto-list-locked" },
  ];
  const blockedReasons = [...proposal.blockedReasons, ...checklist.filter((item) => !item.ok).map((item) => item.label)];
  return {
    schemaVersion: "compas-madness-plan.v1",
    generatedAt: (input.now ?? new Date()).toISOString(),
    mode: "preview-only",
    safety: { previewOnly: true, mintBroadcast: false, listingSignature: false, autoListing: false, custody: false, requiresManualMintBroadcast: true, requiresManualListingSignature: true },
    sourceProposal: { schemaVersion: proposal.schemaVersion, candidate: proposal.candidate, recipient: proposal.recipient, blockedReasons: proposal.blockedReasons },
    policy: input.policy,
    mintPlan: { requestedQuantity, executableQuantity, maxTotalEth, maxGasEth, recipientAddress: proposal.recipient.address, route: "compas-holder-seadrop-public" },
    listingPlan: {
      status: blockedReasons.length ? "blocked" : "suggested",
      costBasisEth,
      targetProfitPercent: input.policy.targetProfitPercent,
      estimatedFeePercent: fees,
      suggestedListPriceEth,
      minimumListPriceEth: input.policy.minimumListingEth,
      netAfterFeesEth,
      estimatedProfitEth,
      marketplace: "OpenSea/Seaport",
      nextStep: blockedReasons.length ? "wait-for-mint" : "manual-listing-review",
    },
    checklist,
    blockedReasons,
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundEth(value: number): number {
  return Number(value.toFixed(6));
}
