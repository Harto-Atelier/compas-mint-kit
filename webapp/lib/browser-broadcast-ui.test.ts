import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { BroadcastPayerSummary } from "../app/components/BrowserBroadcastPanel";

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
