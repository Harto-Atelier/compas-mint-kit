import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BroadcastPayerSummary,
  reconcileInvalidatedBroadcastResult,
} from "../app/components/BrowserBroadcastPanel";
import type { BrowserPreparedMint } from "./browser-broadcast";

const source = readFileSync(new URL("../app/components/BrowserBroadcastPanel.tsx", import.meta.url), "utf8");

test("browser signer defaults to verified holder and binds the visible maximum spend into every plan", () => {
  assert.match(source, /useState<BrowserMintRecipientMode>\("holder"\)/);
  assert.match(source, /Maximum mint spend ETH/);
  assert.equal((source.match(/maxTotalEth,/g) ?? []).length >= 2, true);
});

test("browser signer revokes dropped keys and binds consent to the exact active plan", () => {
  assert.match(source, /function handleDropKeys/);
  assert.match(source, /revokePreparedBrowserMintSigners\(transactions\)/);
  assert.match(source, /setBroadcastConsentBinding\(activeBinding\)/);
  assert.match(source, /consentBinding: broadcastConsentBinding/);
  assert.doesNotMatch(source, /onClick=\{\(\) => setVault\(null\)\}/);
});

test("browser signer invalidates Vault authority for cross-tab and same-document lifecycle changes", () => {
  assert.match(source, /subscribeToLaunchVaultLifecycle/);
  assert.match(source, /setVault\(null\)/);
  assert.match(source, /invalidateBrowserMintTransactions/);
  assert.match(source, /setBroadcastOpen\(false\)/);
  assert.match(source, /setBroadcastConsent\(false\)/);
  assert.match(source, /setBroadcastConsentBinding\(null\)/);
  assert.match(source, /createLaunchVaultGenerationGuard/);
});

test("broadcast rechecks lifecycle generation after every await and cannot resurrect invalidated rows", () => {
  assert.match(source, /broadcastGeneration/);
  assert.match(source, /isCurrent\(broadcastGeneration\)/);
  assert.match(source, /simulationGeneration/);
  assert.match(source, /isCurrent\(simulationGeneration\)/);
});

test("Vault invalidation reconciles a hash returned by an in-flight send while revoking simulated rows", () => {
  const simulated = { id: "burner-1", binding: "plan-a", status: "simulated" } as BrowserPreparedMint;
  const otherSimulated = { id: "burner-2", binding: "plan-a", status: "simulated" } as BrowserPreparedMint;
  const submitted = {
    ...simulated,
    status: "broadcast",
    hash: `0x${"a".repeat(64)}`,
    explorerUrl: `https://basescan.org/tx/0x${"a".repeat(64)}`,
    broadcastAttempted: true,
  } as BrowserPreparedMint;

  const reconciled = reconcileInvalidatedBroadcastResult([simulated, otherSimulated], submitted);

  assert.deepEqual(reconciled, [submitted]);
  assert.equal(reconciled[0].hash, submitted.hash);
  assert.equal(JSON.stringify(reconciled).includes("privateKey"), false);
});

test("Vault invalidation retains an ambiguous in-flight send error as a terminal reconciliation row", () => {
  const simulated = { id: "burner-1", binding: "plan-a", status: "simulated" } as BrowserPreparedMint;
  const ambiguousFailure = {
    ...simulated,
    status: "failed",
    error: "RPC connection closed after the wallet accepted the transaction.",
    broadcastAttempted: true,
  } as BrowserPreparedMint;

  const reconciled = reconcileInvalidatedBroadcastResult([simulated], ambiguousFailure);

  assert.deepEqual(reconciled, [ambiguousFailure]);
  assert.equal(reconciled[0].error, ambiguousFailure.error);
  assert.equal(reconciled[0].broadcastAttempted, true);
});

test("browser signer loops skip terminal broadcast rows and final consent repeats exact review facts", () => {
  assert.match(source, /if \(isTerminalBrowserMint\(tx\)\) continue/);
  assert.match(source, /Maximum spend/);
  assert.match(source, /Verified recipient/);
  assert.match(source, /Collection/);
});

test("final broadcast modal is viewport-bounded and touch-scrollable on mobile", () => {
  assert.match(source, /max-h-\[calc\(100dvh-3rem\)\]/);
  assert.match(source, /overflow-y-auto/);
  assert.match(source, /overscroll-contain/);
});

test("final confirmation renders all 50 burner payer rows so the last remains reachable by modal scroll", () => {
  const payers = Array.from({ length: 50 }, (_, index) => ({
    id: `payer-${index + 1}`,
    alias: `Burner ${index + 1}`,
    address: `0x${(index + 1).toString(16).padStart(40, "0")}`,
  }));
  const markup = renderToStaticMarkup(BroadcastPayerSummary({ payers }));

  assert.equal((markup.match(/<li/g) ?? []).length, 50);
  assert.match(markup, /Burner 1/);
  assert.match(markup, /Burner 50/);
  assert.match(markup, /50 burner payers/);
});
