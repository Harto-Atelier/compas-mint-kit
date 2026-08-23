import assert from "node:assert/strict";
import test from "node:test";
import { buildCompasAutopilotProposal, defaultCompasAutopilotPolicy } from "./compas-autopilot";
import type { OpportunityScanResult } from "./opportunity-scan";

const readyScan: OpportunityScanResult = {
  schemaVersion: "opportunity-scan.v1",
  generatedAt: "2026-08-23T00:00:00.000Z",
  mode: "preview-only",
  safety: { previewOnly: true, execution: "none", broadcast: false, custody: false },
  checked: 1,
  candidates: [{
    query: "compas-drop",
    name: "Compas Drop",
    chain: "Base",
    address: "0x1111111111111111111111111111111111111111",
    signal: "ready",
    score: 90,
    nextAction: "Prepare canary",
    reason: "Public SeaDrop stage is readable and can be simulated before any broadcast.",
    warnings: [],
    openStageCount: 1,
    executableStageCount: 1,
  }],
  errors: [],
};

test("Compas autopilot creates preview-only proposal for ready SeaDrop candidate", () => {
  const proposal = buildCompasAutopilotProposal({
    scan: readyScan,
    policy: defaultCompasAutopilotPolicy(),
    holderAddress: "0x3333333333333333333333333333333333333333",
    now: new Date("2026-08-23T00:00:00.000Z"),
  });

  assert.ok(proposal);
  assert.equal(proposal.safety.broadcast, false);
  assert.equal(proposal.safety.requiresManualBroadcast, true);
  assert.equal(proposal.recipient.status, "resolved");
  assert.equal(proposal.proposedPlan.nextStep, "simulate-in-browser");
  assert.equal(proposal.blockedReasons.length, 0);
});

test("Compas autopilot blocks holder recipient without verified Compas session", () => {
  const proposal = buildCompasAutopilotProposal({ scan: readyScan, policy: defaultCompasAutopilotPolicy() });
  assert.ok(proposal);
  assert.equal(proposal.recipient.status, "missing-holder-session");
  assert.equal(proposal.proposedPlan.nextStep, "connect-compas-holder");
  assert.match(proposal.blockedReasons.join(" "), /holder recipient/i);
});

test("Compas autopilot returns no proposal when disabled", () => {
  const policy = { ...defaultCompasAutopilotPolicy(), enabled: false };
  assert.equal(buildCompasAutopilotProposal({ scan: readyScan, policy }), null);
});
