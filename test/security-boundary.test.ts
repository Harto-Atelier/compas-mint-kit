import assert from "node:assert/strict";
import test from "node:test";

import { redactSensitive } from "../src/rpc-blast";
import { parseRunConfig } from "../src/run-config";

const baseConfig = {
  schemaVersion: 1,
  collection: {
    name: "Compas Test",
    address: "0x1111111111111111111111111111111111111111",
    chain: { key: "base", name: "Base", chainId: 8453 },
  },
  stages: [
    {
      id: "public",
      label: "PUBLIC",
      source: "onchain-seadrop",
      status: "upcoming",
      startTime: "2027-01-01T00:00:00.000Z",
      endTime: "2027-01-02T00:00:00.000Z",
      priceEth: 0.02,
      maxPerWallet: 2,
      feeRecipient: "0x2222222222222222222222222222222222222222",
      warnings: [],
    },
  ],
  quantities: [{ stageId: "public", quantity: 1 }],
  walletCount: 1,
  maxFeeGwei: 0.1,
  gasLimit: 250000,
  notes: [],
};

test("parseRunConfig rejects RPC and signed transaction material", () => {
  assert.throws(
    () => parseRunConfig({ ...baseConfig, rpcUrls: ["https://base-mainnet.g.alchemy.com/v2/secret-key"] }),
    /Secret-like field .*rpcUrls/i,
  );
  assert.throws(
    () => parseRunConfig({ ...baseConfig, notes: ["raw tx 0x02" + "a".repeat(200)] }),
    /Raw-transaction-shaped value/i,
  );
});

test("redactSensitive strips raw transactions and 64-hex key material from RPC errors", () => {
  const rawTx = "0x02" + "b".repeat(200);
  const key = "0x" + "c".repeat(64);
  const redacted = redactSensitive(`failed tx=${rawTx} key=${key}`);
  assert.equal(redacted.includes(rawTx), false);
  assert.equal(redacted.includes(key.slice(2)), false);
  assert.match(redacted, /\[redacted-raw-transaction\]/);
  assert.match(redacted, /\[redacted-64-hex\]/);
});
