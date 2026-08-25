import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { CHAINS, GUIDED_DEFAULT_CHAINS, guidedMintChainOptions } from "./chains";

test("guided chain options default to Ethereum/Base and hide Robinhood unless admin low-latency flags are all enabled", () => {
  assert.deepEqual(GUIDED_DEFAULT_CHAINS.map((chain) => chain.key), ["ethereum", "base"]);
  assert.equal(CHAINS.some((chain) => chain.key === "robinhood" && chain.chainId === 4663), true);

  assert.deepEqual(guidedMintChainOptions().map((chain) => chain.key), ["ethereum", "base"]);
  assert.deepEqual(guidedMintChainOptions({ admin: true, lowLatencyBroadcast: true, multiRpc: true }).map((chain) => chain.key), ["ethereum", "base"]);
  assert.deepEqual(
    guidedMintChainOptions({ admin: true, lowLatencyBroadcast: true, multiRpc: true, robinhoodSequencer: true }).map((chain) => chain.key),
    ["ethereum", "base", "robinhood"],
  );
});

test("guided mint console uses the gated chain list, leaving Robinhood in advanced RunConfig only", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "app/components/MintConsole.tsx"), "utf8");
  assert.match(source, /guidedMintChainOptions\(\)/);
  assert.match(source, /GUIDED_CHAIN_OPTIONS\.map/);
  assert.match(source, /FINAL_PRODUCT_CHAIN_OPTIONS[\s\S]*robinhood/);
});

test("frontend mint discovery does not ship Robinhood low-latency provider URLs or NEXT_PUBLIC RPC secrets", () => {
  const files = [
    "lib/mint-discovery.ts",
    "lib/chains.ts",
    "app/components/MintConsole.tsx",
  ];
  const source = files.map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");

  assert.doesNotMatch(source, /NEXT_PUBLIC_.*(?:RPC|ALCHEMY|QUICKNODE|SEQUENCER)/i);
  assert.doesNotMatch(source, /https?:\/\/[^\s"'`]*quicknode[^\s"'`]*/i);
  assert.doesNotMatch(source, /g\.alchemy\.com\/v2\/[A-Za-z0-9_-]+/i);
  assert.doesNotMatch(source, /sequencer\.mainnet\.chain\.robinhood\.com/i);
});
