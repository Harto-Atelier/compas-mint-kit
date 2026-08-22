import assert from "node:assert/strict";
import test from "node:test";
import { buildRunConfigExport } from "./run-config";
import type { CollectionCard } from "./mint-types";

const collection: CollectionCard = {
  name: "Compas Test",
  slug: "compas-test",
  address: "0x1111111111111111111111111111111111111111",
  chain: {
    key: "base",
    name: "Base",
    chainId: 8453,
    explorer: "https://basescan.org",
    nativeSymbol: "ETH",
  },
  openseaUrl: "https://opensea.io/collection/compas-test",
  explorerUrl: "https://basescan.org/address/0x1111111111111111111111111111111111111111",
  source: "address",
};

const baseRequest = {
  collection,
  stages: [
    {
      id: "public",
      label: "PUBLIC STAGE",
      source: "onchain-seadrop",
      status: "upcoming",
      startTime: "2027-01-01T00:00:00.000Z",
      endTime: "2027-01-02T00:00:00.000Z",
      priceEth: "0.02",
      maxPerWallet: 2,
      feeRecipient: "0x2222222222222222222222222222222222222222",
      warnings: [],
    },
  ],
  quantities: [{ stageId: "public", quantity: 1 }],
  walletCount: 2,
  walletAliases: ["mint-ops", "mint-backup"],
  maxFeeGwei: 0.1,
  gasLimit: 250000,
  drainAddress: "0x3333333333333333333333333333333333333333",
  finalProduct: {
    targetChainKey: "ethereum",
    rpcStatus: "ready",
    maxSpendEth: 0.5,
    concurrency: 2,
  },
} as const;

test("buildRunConfigExport returns no-secret CLI config", () => {
  const response = buildRunConfigExport(baseRequest, new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(response.ok, true);
  assert.equal(response.config.schemaVersion, "compas.mint-run-config.v1");
  assert.deepEqual(response.config.wallets.aliases, ["mint-ops", "mint-backup"]);
  assert.equal(response.config.safety.canBroadcast, false);
  assert.equal(response.config.safety.includesPrivateKeys, false);
  assert.equal(response.config.safety.includesRawTransactions, false);
  assert.equal(response.config.stages[0]?.quantityPerWallet, 1);
  assert.equal(response.config.execution.chain.key, "ethereum");
  assert.equal(response.config.execution.walletAliasCount, 2);
  assert.equal(response.config.execution.maxSpendEth, 0.5);
  assert.equal(response.config.execution.concurrency, 2);
  assert.match(response.config.execution.localCliCommand, /npm run dev -- --config \.\/compas-test-ethereum-run-config\.json --dry-run/);
  assert.equal(response.config.execution.webPlansCliExecutesLocally, true);
  assert.equal(response.filename, "compas-test-ethereum-run-config.json");
  assert.equal("calldata" in response.config.stages[0]!, false);
  assert.equal("signedTx" in response.config, false);
});

test("buildRunConfigExport rejects forbidden secret/transaction fields", () => {
  assert.throws(
    () => buildRunConfigExport({ ...baseRequest, privateKey: "0xabc" }),
    /Forbidden RunConfig field/,
  );
  assert.throws(
    () => buildRunConfigExport({ ...baseRequest, rpcUrls: ["https://base-mainnet.g.alchemy.com/v2/secret"] }),
    /Forbidden RunConfig field/,
  );
  assert.throws(
    () => buildRunConfigExport({ ...baseRequest, notes: ["signed tx 0x02" + "a".repeat(200)] }),
    /raw-transaction-shaped value/,
  );
  assert.throws(
    () => buildRunConfigExport({ ...baseRequest, stages: [{ ...baseRequest.stages[0], calldataPreview: "0x1234" }] }),
    /Forbidden RunConfig field/,
  );
  assert.throws(
    () => buildRunConfigExport({ ...baseRequest, walletKey: "WALLET_KEY_ENV" }),
    /Forbidden RunConfig field/,
  );
  assert.throws(
    () => buildRunConfigExport({ ...baseRequest, notes: ["seed phrase should never be here"], seed: "test" }),
    /Forbidden RunConfig field/,
  );
});

test("buildRunConfigExport requires selected quantity, aliases, and spend/concurrency guardrails", () => {
  assert.throws(
    () => buildRunConfigExport({ ...baseRequest, quantities: [{ stageId: "public", quantity: 0 }] }),
    /quantity above zero/,
  );
  assert.throws(
    () => buildRunConfigExport({ ...baseRequest, walletAliases: ["only-one"] }),
    /aliases must match wallet count/i,
  );
  assert.throws(
    () => buildRunConfigExport({ ...baseRequest, finalProduct: { ...baseRequest.finalProduct, maxSpendEth: 0.01 } }),
    /Max spend cap/,
  );
  assert.throws(
    () => buildRunConfigExport({ ...baseRequest, finalProduct: { ...baseRequest.finalProduct, concurrency: 3 } }),
    /concurrency/i,
  );
});
