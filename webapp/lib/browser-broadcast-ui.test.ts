import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

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