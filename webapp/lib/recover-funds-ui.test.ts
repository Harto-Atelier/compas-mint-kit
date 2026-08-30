import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const flowSource = readFileSync(new URL("../app/components/GuidedHolderFlow.tsx", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../app/components/RecoverFundsPanel.tsx", import.meta.url), "utf8");

test("finish step runs the anti-loss onchain residual re-check before dropping signer authority", () => {
  // Finish must re-read every burner balance onchain through the safety gate.
  assert.match(flowSource, /confirmGuidedFinishResidualSafety/);
  assert.match(flowSource, /async function finishSafely/);
  assert.match(flowSource, /Final anti-loss check/);
  // The blocked path routes into recovery, never past it, and never sweeps.
  assert.match(flowSource, /Finish blocked by the final onchain check/);
  assert.match(flowSource, /manual exact sweep/);
  assert.match(flowSource, /Nothing is swept automatically/);
  // Signer authority drops only after the fresh check passes.
  const finishBody = flowSource.slice(flowSource.indexOf("async function finishSafely"), flowSource.indexOf("const networkGasMaxWei"));
  assert.ok(finishBody.indexOf("confirmGuidedFinishResidualSafety") < finishBody.indexOf("revokePreparedBrowserMintSigners"));
  assert.match(finishBody, /if \(!safety\.safe\)/);
});

test("a visible Recover funds entry is mounted on the guide surface, not hidden in Advanced", () => {
  assert.match(flowSource, /<RecoverFundsPanel/);
  assert.match(flowSource, /journal=\{recoveryJournal\}/);
  // Mounted in the always-rendered guide body, before the step conditionals.
  assert.ok(flowSource.indexOf("<RecoverFundsPanel") < flowSource.indexOf('step === "holder"'));
  assert.match(panelSource, />\s*\{open \? "Hide recovery" : "Recover funds"\}/);
});

test("Recover funds panel scans known burners read-only and guides a holder-signed manual sweep", () => {
  assert.match(panelSource, /collectKnownBurners/);
  assert.match(panelSource, /scanKnownBurnerResidualBalances/);
  assert.match(panelSource, /writeStoredRecoverFundsScan/);
  assert.match(panelSource, /Manual sweep to your verified wallet/);
  assert.match(panelSource, /You sign every sweep; nothing is automatic\./);
  assert.match(panelSource, /Open encrypted Vault for manual sweep/);
  // Read-only: the panel must never import or invoke signing/broadcast/sending APIs.
  assert.doesNotMatch(panelSource, /signPreparedBrowserMint|broadcastPreparedBrowserMint|sendTransaction|eth_sendTransaction|fireSignedMints/);
  assert.doesNotMatch(panelSource, /privateKey/);
});

test("vault stale-balance reminder surfaces a visible sweep pending banner", () => {
  assert.match(panelSource, /assessVaultSweepReminder/);
  assert.match(panelSource, /sweepReminder\.sweepPending \?/);
  assert.match(panelSource, /Sweep pending ·/);
  assert.match(panelSource, /role="alert"/);
});
