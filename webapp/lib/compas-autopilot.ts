import type { OpportunityCandidate, OpportunityScanResult } from "./opportunity-scan";

export const COMPAS_AUTOPILOT_HANDOFF_KEY = "compas.autopilotHandoff.v1";

export interface CompasAutopilotPolicy {
  enabled: boolean;
  mode: "auto-propose" | "auto-simulate";
  maxTotalEth: number;
  maxQuantity: number;
  maxGasGwei: number;
  allowedChains: string[];
  recipientMode: "verified-compas-holder";
  requireExecutableSeaDrop: true;
}

export interface CompasAutopilotProposal {
  schemaVersion: "compas-autopilot-proposal.v1";
  generatedAt: string;
  mode: "preview-only";
  automation: "auto-propose" | "auto-simulate";
  safety: {
    previewOnly: true;
    execution: "none";
    broadcast: false;
    custody: false;
    requiresManualBroadcast: true;
  };
  candidate: Pick<OpportunityCandidate, "query" | "name" | "chain" | "address" | "score" | "signal" | "nextAction">;
  policy: CompasAutopilotPolicy;
  recipient: {
    mode: "verified-compas-holder";
    address?: string;
    status: "resolved" | "missing-holder-session";
  };
  proposedPlan: {
    quantity: number;
    maxTotalEth: number;
    maxGasGwei: number;
    route: "watch-scan-to-browser-signer";
    nextStep: "simulate-in-browser" | "connect-compas-holder" | "manual-review";
  };
  checklist: { label: string; ok: boolean }[];
  blockedReasons: string[];
}

export interface CompasAutopilotHandoff {
  schemaVersion: "compas-autopilot-handoff.v1";
  createdAt: string;
  proposal: CompasAutopilotProposal;
  signerDefaults: {
    chain: string;
    collectionAddress: string;
    quantity: number;
    recipientMode: "holder";
    holderRecipientAddress?: string;
    maxTotalEth: number;
    maxGasGwei: number;
  };
  safety: CompasAutopilotProposal["safety"];
}

export function defaultCompasAutopilotPolicy(): CompasAutopilotPolicy {
  return {
    enabled: true,
    mode: "auto-propose",
    maxTotalEth: 0.05,
    maxQuantity: 1,
    maxGasGwei: 0.2,
    allowedChains: ["Base", "Ethereum"],
    recipientMode: "verified-compas-holder",
    requireExecutableSeaDrop: true,
  };
}

export function buildCompasAutopilotProposal(input: {
  scan: OpportunityScanResult | null;
  policy: CompasAutopilotPolicy;
  holderAddress?: string | null;
  now?: Date;
}): CompasAutopilotProposal | null {
  if (!input.policy.enabled || !input.scan) return null;
  const candidate = input.scan.candidates.find((item) => item.signal === "ready" && input.policy.allowedChains.includes(item.chain)) ?? input.scan.candidates[0];
  if (!candidate) return null;

  const holderResolved = Boolean(input.holderAddress && /^0x[a-fA-F0-9]{40}$/.test(input.holderAddress));
  const checklist = [
    { label: "Ready opportunity signal", ok: candidate.signal === "ready" },
    { label: "Executable SeaDrop public stage", ok: candidate.executableStageCount > 0 },
    { label: "Allowed chain", ok: input.policy.allowedChains.includes(candidate.chain) },
    { label: "Compas holder recipient resolved", ok: holderResolved },
    { label: "Manual broadcast still required", ok: true },
  ];
  const blockedReasons = checklist.filter((item) => !item.ok).map((item) => item.label);

  return {
    schemaVersion: "compas-autopilot-proposal.v1",
    generatedAt: (input.now ?? new Date()).toISOString(),
    mode: "preview-only",
    automation: input.policy.mode,
    safety: { previewOnly: true, execution: "none", broadcast: false, custody: false, requiresManualBroadcast: true },
    candidate: {
      query: candidate.query,
      name: candidate.name,
      chain: candidate.chain,
      address: candidate.address,
      score: candidate.score,
      signal: candidate.signal,
      nextAction: candidate.nextAction,
    },
    policy: input.policy,
    recipient: { mode: "verified-compas-holder", address: input.holderAddress ?? undefined, status: holderResolved ? "resolved" : "missing-holder-session" },
    proposedPlan: {
      quantity: Math.max(1, Math.floor(input.policy.maxQuantity)),
      maxTotalEth: input.policy.maxTotalEth,
      maxGasGwei: input.policy.maxGasGwei,
      route: "watch-scan-to-browser-signer",
      nextStep: holderResolved ? (blockedReasons.length ? "manual-review" : "simulate-in-browser") : "connect-compas-holder",
    },
    checklist,
    blockedReasons,
  };
}

export function buildCompasAutopilotHandoff(proposal: CompasAutopilotProposal, now = new Date()): CompasAutopilotHandoff {
  return {
    schemaVersion: "compas-autopilot-handoff.v1",
    createdAt: now.toISOString(),
    proposal,
    signerDefaults: {
      chain: proposal.candidate.chain,
      collectionAddress: proposal.candidate.address,
      quantity: proposal.proposedPlan.quantity,
      recipientMode: "holder",
      holderRecipientAddress: proposal.recipient.address,
      maxTotalEth: proposal.proposedPlan.maxTotalEth,
      maxGasGwei: proposal.proposedPlan.maxGasGwei,
    },
    safety: proposal.safety,
  };
}
