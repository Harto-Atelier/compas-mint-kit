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

test("guided holder UI exposes simulation only, fixes recipient to holder, and has no mint broadcast import", () => {
  assert.match(source, /buildGuidedMintSimulationPlan/);
  assert.match(source, /simulatePreparedBrowserMint/);
  assert.match(source, /Recipient · verified holder/);
  assert.match(source, /No mint broadcast/);
  assert.match(source, /const \[reviewedQuantity/);
  assert.match(source, /quantityPerBurner: reviewedQuantity/);
  assert.doesNotMatch(source, /broadcastPreparedBrowserMint/);
  assert.doesNotMatch(source, /option value="robinhood"/);
});

test("guided holder UI keeps imports, bulk tools, and CLI behind Advanced navigation", () => {
  assert.match(source, /<details/);
  assert.match(source, />Advanced</);
  assert.match(source, /Open Vault tools/);
  assert.match(source, /Open CLI planner/);
});

test("console opens on the minimal Guide and delegates dense operator tools to Advanced tabs", () => {
  assert.match(shellSource, /import GuidedHolderFlow/);
  assert.match(shellSource, /type MainTab = "Guide"/);
  assert.match(shellSource, /initialTab = "Guide"/);
  assert.match(shellSource, /<GuidedHolderFlow embedded onOpenAdvanced=/);
  assert.match(shellSource, /Advanced tools/);
  assert.doesNotMatch(appRouteSource, /initialTab="Mints"/);
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
