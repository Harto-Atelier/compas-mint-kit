import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDryRunPlan,
  parseCliPlanArgs,
  parseWalletSources,
  resolveWalletsFromEnv,
} from "../src/multi-wallet-planner";
import { SEADROP_ADDRESS, LocalMintPlan } from "../src/seadrop-public";

const DUMMY_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DUMMY_ADDRESS = "0x000000000000000000000000000000000000dEaD";

const mintPlan: LocalMintPlan = {
  to: SEADROP_ADDRESS,
  data: "0x12345678" + "00".repeat(32),
  value: 50_000_000_000_000_000n,
  feeRecipient: "0x0000a26b00c1F0DF003000390027140000fAa719",
  drop: {
    mintPrice: 50_000_000_000_000_000n,
    startTime: 1_700_000_000,
    endTime: 1_800_000_000,
    maxTotalMintableByWallet: 3,
    feeBps: 500,
    restrictFeeRecipients: false,
  },
};

test("parseWalletSources accepts alias=ENV_VAR descriptors and rejects raw private keys", () => {
  assert.deepEqual(parseWalletSources(["treasury=COMPAS_TREASURY_KEY", "backup:COMPAS_BACKUP_KEY", "COMPAS_THIRD_KEY"]), [
    { alias: "treasury", envVar: "COMPAS_TREASURY_KEY" },
    { alias: "backup", envVar: "COMPAS_BACKUP_KEY" },
    { alias: "COMPAS_THIRD_KEY", envVar: "COMPAS_THIRD_KEY" },
  ]);

  assert.throws(
    () => parseWalletSources([DUMMY_PRIVATE_KEY]),
    /pass wallet aliases or env var names, not raw private keys/i
  );
});

test("resolveWalletsFromEnv derives addresses without retaining key material", () => {
  const wallets = resolveWalletsFromEnv(parseWalletSources(["hot=HOT_WALLET_KEY", "cold=COLD_WALLET_ADDRESS"]), {
    HOT_WALLET_KEY: DUMMY_PRIVATE_KEY,
    COLD_WALLET_ADDRESS: DUMMY_ADDRESS,
  });

  assert.equal(wallets[0].alias, "hot");
  assert.equal(wallets[0].envVar, "HOT_WALLET_KEY");
  assert.equal(wallets[0].sourceKind, "private-key-env");
  assert.match(wallets[0].address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(JSON.stringify(wallets).includes(DUMMY_PRIVATE_KEY.slice(2)), false);

  assert.equal(wallets[1].sourceKind, "address-env");
  assert.equal(wallets[1].address, "0x000000000000000000000000000000000000dEaD");
});

test("buildDryRunPlan estimates calldata, wallet costs and concurrency batches", () => {
  const plan = buildDryRunPlan({
    chainName: "Base",
    chainId: 8453,
    nativeSymbol: "ETH",
    nftContract: "0x000000000000000000000000000000000000c0Fe",
    quantity: 2,
    wallets: [
      { alias: "w1", envVar: "W1_KEY", address: "0x0000000000000000000000000000000000000001", sourceKind: "private-key-env" },
      { alias: "w2", envVar: "W2_KEY", address: "0x0000000000000000000000000000000000000002", sourceKind: "private-key-env" },
      { alias: "w3", envVar: "W3_KEY", address: "0x0000000000000000000000000000000000000003", sourceKind: "private-key-env" },
    ],
    mintPlan,
    gasLimit: 250_000,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 50_000_000n,
    concurrency: 2,
    mode: "dry-run",
  });

  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.broadcastEnabled, false);
  assert.equal(plan.calldata.bytes, 36);
  assert.equal(plan.totals.wallets, 3);
  assert.equal(plan.totals.transactions, 3);
  assert.equal(plan.totals.mintValueWei, 150_000_000_000_000_000n);
  assert.equal(plan.perWallet[0].maxUpfrontWei, 50_500_000_000_000_000n);
  assert.deepEqual(plan.concurrency.batches.map((batch) => batch.map((entry) => entry.alias)), [["w1", "w2"], ["w3"]]);
});

test("parseCliPlanArgs defaults to dry-run and reserves broadcast behind an explicit blocked flag", () => {
  const opts = parseCliPlanArgs([
    "--wallet", "hot=HOT_WALLET_KEY",
    "--contract", "0x000000000000000000000000000000000000c0Fe",
  ]);
  assert.equal(opts.mode, "dry-run");
  assert.equal(opts.broadcastRequested, false);

  const broadcast = parseCliPlanArgs([
    "--wallet", "hot=HOT_WALLET_KEY",
    "--contract", "0x000000000000000000000000000000000000c0Fe",
    "--broadcast",
  ]);
  assert.equal(broadcast.mode, "broadcast-requested");
  assert.equal(broadcast.broadcastRequested, true);
});
