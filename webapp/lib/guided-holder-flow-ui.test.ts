import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/components/GuidedHolderFlow.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../components/MintConsoleShell.tsx", import.meta.url), "utf8");
const globalCssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const appRouteSource = readFileSync(new URL("../app/app/page.tsx", import.meta.url), "utf8");

test("guided holder UI wires canonical Vault projection, exact funding review, and explicit per-row holder sends", () => {
  assert.match(source, /LAUNCH_VAULT_STORAGE_KEY/);
  assert.match(source, /decryptLaunchVaultBackup/);
  assert.match(source, /projectGuidedBurners/);
  assert.match(source, /buildGuidedFundingReview/);
  assert.match(source, /checkConnectedHolderFundingPreflight/);
  assert.match(source, /submitConnectedHolderFundingTransaction/);
  assert.match(source, /Verify receipt & balance/);
  assert.match(source, /Confirm transfer/);
});

test("guided holder UI reuses the exact bound simulated plan for explicit live mint consent and receipt polling", () => {
  assert.match(source, /buildGuidedMintSimulationPlan/);
  assert.match(source, /simulatePreparedBrowserMint/);
  assert.match(source, /Recipient · verified holder/);
  assert.match(source, /broadcastPreparedBrowserMint/);
  assert.match(source, /pollPreparedBrowserMintReceipt/);
  assert.match(source, /Explicit final live mint consent/);
  assert.match(source, /Submitted/);
  assert.match(source, /Confirming/);
  assert.match(source, /Confirmed/);
  assert.match(source, /Failed/);
  assert.match(source, /const \[reviewedQuantity/);
  assert.match(source, /reviewedQuantity === null/);
  assert.match(source, /quantityPerBurner,/);
  assert.match(source, /clearBoundRun\(\);\s*setQuantityPerBurner/);
  assert.match(source, /clearBoundRun\(\);\s*setMintValueMaxEth/);
  assert.match(source, /clearBoundRun\(\);\s*setMintGasLimit/);
  assert.match(source, /clearBoundRun\(\);\s*setMaxFeeGwei/);
  assert.doesNotMatch(source, /Prepare local txs/);
  assert.doesNotMatch(source, /option value="robinhood"/);
});

test("guided holder UI separates mint value from network gas and blocks unsafe finish with recovery handoff", () => {
  assert.match(source, /Maximum mint value/);
  assert.match(source, /Network gas estimate \/ max/);
  assert.match(source, /assessGuidedFinish/);
  assert.match(source, /Check burner balances/);
  assert.match(source, /Manual exact sweep/);
  assert.match(source, /Resume receipt reconciliation/);
  assert.match(source, /Finish safely/);
  assert.doesNotMatch(source, /all-in/i);
  assert.doesNotMatch(source, /auto-send|auto-retry|auto-sweep/i);
});

test("guided holder UI keeps imports, bulk tools, and CLI behind optional Advanced navigation", () => {
  assert.match(source, /<details/);
  assert.match(source, /Optional advanced tools/);
  assert.match(source, /Optional only/);
  assert.match(source, /Open Vault tools/);
  assert.match(source, /Open CLI planner/);
});

test("console opens on the minimal Guide and delegates dense operator tools to collapsed optional tabs", () => {
  assert.match(shellSource, /import GuidedHolderFlow/);
  assert.match(shellSource, /type MainTab = "Guide"/);
  assert.match(shellSource, /initialTab = "Guide"/);
  assert.match(shellSource, /<GuidedHolderFlow embedded onOpenAdvanced=/);
  assert.match(shellSource, /Mint console optional sections/);
  assert.match(shellSource, /Optional sections/);
  assert.match(shellSource, /Advanced tools/);
  assert.doesNotMatch(shellSource, /open=\{active !== "Guide"\}/);
  assert.doesNotMatch(appRouteSource, /initialTab="Mints"/);
  assert.doesNotMatch(shellSource, /Import wallets to start/);
  assert.doesNotMatch(shellSource, /Harto operator shell/);
});

test("mobile guide makes the current step prominent while optional details stay secondary", () => {
  assert.match(source, /Current step/);
  assert.match(source, /overflow-x-auto/);
  assert.match(source, /<details/);
  assert.match(source, /Holder guide/);
  assert.match(source, /Optional guardrails/);
  assert.match(source, /Optional advanced tools/);
});

test("phone Guide removes shell chrome and hero so the active step stays above the fold", () => {
  assert.match(shellSource, /data-active-tab=\{activeTab\}/);
  assert.match(shellSource, /console-sidebar/);
  assert.match(shellSource, /guide-mobile-surface/);
  assert.match(shellSource, /active === "Guide" \? "hidden sm:grid" : "grid"/);
  assert.match(globalCssSource, /@media \(max-width: 639px\)/);
  assert.match(globalCssSource, /data-active-tab="Guide"[^\n]*\.console-sidebar/);
  assert.match(globalCssSource, /data-active-tab="Guide"[^\n]*\.guide-mobile-surface[^\n]*header/);
  assert.doesNotMatch(globalCssSource, /data-active-tab="Guide"[^\n]*nav\[aria-label="Guided holder flow"\]/);
});

test("guided lifecycle invalidation clears stale funding authority while retaining reconciliation evidence", () => {
  assert.match(source, /setFundingPlan\(null\)/);
  assert.match(source, /setExecutionCapabilities\(null\)/);
  assert.match(source, /setPreflight\(null\)/);
  assert.match(source, /setFundingConsent\(\{\}\)/);
  assert.match(source, /setSubmissions\(\{\}\)/);
  assert.match(source, /setVerifications\(\[\]\)/);
  assert.match(source, /markGuidedMintReceiptsForReconciliation/);
  assert.match(source, /invalidateBrowserMintTransactions/);
});

test("guided funding authority captures and rechecks lifecycle generation across review and submit awaits", () => {
  assert.match(source, /reviewGeneration/);
  assert.match(source, /isCurrent\(reviewGeneration\)/);
  assert.match(source, /fundingGeneration/);
  assert.match(source, /isCurrent\(fundingGeneration\)/);
  assert.match(source, /authorityCheckedFundingProvider/);
});

test("guided recovery is secret-free, persistent, zero-buffered by default, and final consent is numerically complete", () => {
  assert.match(source, /GUIDED_HOLDER_RECOVERY_STORAGE_KEY/);
  assert.match(source, /readGuidedHolderRecoveryJournal/);
  assert.match(source, /writeGuidedHolderRecoveryJournal/);
  assert.match(source, /useState\("0"\)/);
  assert.match(source, /Collection · \{discovery\.collection\.name\}/);
  assert.match(source, /Maximum network gas · \{formatEther/);
});

test("guided fast path surface is feature-flagged, post-simulation, human-readable, and health-backed", () => {
  assert.match(source, /GUIDED_EXECUTION_MODE_SURFACE_ENABLED/);
  assert.match(source, /NEXT_PUBLIC_GUIDED_EXECUTION_MODE_SURFACE/);
  assert.match(source, /<ExecutionModeSurface simulationComplete=\{simulationComplete\} humanFlow=\{humanFlow\} \/>/);
  assert.match(source, /if \(!GUIDED_EXECUTION_MODE_SURFACE_ENABLED \|\| !simulationComplete\) return null/);
  assert.match(source, /Vía rápida/);
  assert.match(source, /RelayHealthBadge/);
  assert.match(source, /NEXT_PUBLIC_COMPAS_RELAY_URL/);
  assert.match(source, /Preparado/);
  assert.match(source, /Firmado/);
  assert.match(source, /Enviado/);
  assert.match(source, /Confirmado/);
  assert.match(source, /No completado/);
  assert.match(source, /Última actualización/);
  assert.match(source, /Receipt · Blockscout/);
  assert.match(source, /Avanzado/);
  assert.doesNotMatch(source, /mocked placeholder state/);
  assert.doesNotMatch(source, /uploadLowLatency|sendLowLatency|startArmedLaunch|relay\.send|relay\.upload/);
});
