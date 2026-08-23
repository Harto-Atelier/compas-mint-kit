import assert from "node:assert/strict";
import test from "node:test";
import { buildCompasMadnessPlan, defaultCompasMadnessPolicy } from "./compas-madness";
import type { CompasAutopilotProposal } from "./compas-autopilot";

const proposal: CompasAutopilotProposal = {
  schemaVersion: "compas-autopilot-proposal.v1",
  generatedAt: "2026-08-23T00:00:00.000Z",
  mode: "preview-only",
  automation: "auto-propose",
  safety: { previewOnly: true, execution: "none", broadcast: false, custody: false, requiresManualBroadcast: true },
  candidate: { query: "mad-drop", name: "Mad Drop", chain: "Base", address: "0x1111111111111111111111111111111111111111", score: 95, signal: "ready", nextAction: "Prepare canary" },
  policy: { enabled: true, mode: "auto-propose", maxTotalEth: 0.15, maxQuantity: 1, maxGasGwei: 0.2, allowedChains: ["Base"], recipientMode: "verified-compas-holder", requireExecutableSeaDrop: true, canaryMode: true, allowedContracts: [] },
  recipient: { mode: "verified-compas-holder", address: "0x3333333333333333333333333333333333333333", status: "resolved" },
  proposedPlan: { quantity: 1, maxTotalEth: 0.15, maxGasGwei: 0.2, route: "watch-scan-to-browser-signer", nextStep: "simulate-in-browser" },
  checklist: [{ label: "Executable SeaDrop public stage", ok: true }],
  blockedReasons: [],
};

test("Compas Madness builds preview-only quantity mint plan with profit listing suggestion", () => {
  const policy = { ...defaultCompasMadnessPolicy(), quantity: 5, maxTotalEth: 0.25, maxGasEth: 0.025, targetProfitPercent: 30, minimumListingEth: 0.08 };
  const plan = buildCompasMadnessPlan({ proposal, policy, now: new Date("2026-08-23T00:01:00.000Z") });
  assert.ok(plan);
  assert.equal(plan.safety.mintBroadcast, false);
  assert.equal(plan.safety.listingSignature, false);
  assert.equal(plan.mintPlan.requestedQuantity, 5);
  assert.equal(plan.mintPlan.executableQuantity, 5);
  assert.equal(plan.listingPlan.status, "suggested");
  assert.equal(plan.listingPlan.suggestedListPriceEth >= 0.08, true);
  assert.equal(JSON.stringify(plan).includes("privateKey"), false);
});

test("Compas Madness canary mode clamps executable quantity to one", () => {
  const policy = { ...defaultCompasMadnessPolicy(), quantity: 20, mode: "madness-canary" as const };
  const plan = buildCompasMadnessPlan({ proposal, policy });
  assert.ok(plan);
  assert.equal(plan.mintPlan.requestedQuantity, 20);
  assert.equal(plan.mintPlan.executableQuantity, 1);
});

test("Compas Madness blocks listing suggestion when holder recipient is unresolved", () => {
  const blockedProposal = { ...proposal, recipient: { mode: "verified-compas-holder" as const, status: "missing-holder-session" as const }, proposedPlan: { ...proposal.proposedPlan, nextStep: "connect-compas-holder" as const } };
  const plan = buildCompasMadnessPlan({ proposal: blockedProposal, policy: defaultCompasMadnessPolicy() });
  assert.ok(plan);
  assert.equal(plan.listingPlan.status, "blocked");
  assert.match(plan.blockedReasons.join(" "), /Compas holder recipient/i);
});
