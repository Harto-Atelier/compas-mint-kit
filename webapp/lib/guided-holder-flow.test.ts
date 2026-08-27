import assert from "node:assert/strict";
import test from "node:test";

import {
  GUIDED_HOLDER_STEPS,
  buildGuidedFundingReview,
  buildGuidedMintSimulationPlan,
  projectGuidedBurners,
  resolveGuidedHolderStep,
} from "./guided-holder-flow";
import type { CompasGateSession } from "./compas-gate";
import type { LaunchVaultPayload } from "./encrypted-launch-vault";
import type { MintDiscoveryResponse } from "./mint-types";

const HOLDER = "0x1111111111111111111111111111111111111111";
const BURNER_ONE = "0x2222222222222222222222222222222222222222";
const BURNER_TWO = "0x3333333333333333333333333333333333333333";
const ETH_BURNER = "0x4444444444444444444444444444444444444444";
const COLLECTION = "0x5555555555555555555555555555555555555555";
const FEE_RECIPIENT = "0x6666666666666666666666666666666666666666";

const holder: CompasGateSession = {
  address: HOLDER,
  compasCount: 2,
  verifiedAt: 1_777_000_000_000,
};

const vault: LaunchVaultPayload = {
  version: 1,
  launchId: "guided-launch",
  launchName: "Guided launch",
  createdAt: 1_777_000_000_000,
  updatedAt: 1_777_000_000_000,
  wallets: [
    { id: "base-1", label: "Burner 1", chain: "Base", address: BURNER_ONE, privateKey: `0x${"1".repeat(64)}`, createdAt: 1 },
    { id: "base-2", label: "Burner 2", chain: "Base", address: BURNER_TWO, privateKey: `0x${"2".repeat(64)}`, createdAt: 2 },
    { id: "eth-1", label: "ETH burner", chain: "ETH", address: ETH_BURNER, privateKey: `0x${"3".repeat(64)}`, createdAt: 3 },
  ],
};

const discovery: MintDiscoveryResponse = {
  ok: true,
  query: "guided-drop",
  resolvedAt: "2026-08-25T00:00:00.000Z",
  collection: {
    name: "Guided drop",
    slug: "guided-drop",
    address: COLLECTION,
    chain: { key: "base", chainId: 8453, name: "Base", explorer: "https://basescan.org", nativeSymbol: "ETH" },
    openseaUrl: "https://opensea.io/collection/guided-drop",
    explorerUrl: `https://basescan.org/address/${COLLECTION}`,
    source: "opensea",
  },
  stages: [
    {
      id: "public",
      label: "Public",
      source: "onchain-seadrop",
      status: "live",
      startTime: null,
      endTime: null,
      priceEth: "0.05",
      maxPerWallet: 2,
      eligible: "checked",
      summary: "Executable public SeaDrop stage.",
      feeRecipient: FEE_RECIPIENT,
      calldataPreview: "0xdeadbeef",
      warnings: [],
    },
  ],
  signals: [],
  warnings: [],
};

test("guided holder flow keeps the required web-first order and advances one gate at a time", () => {
  assert.deepEqual(GUIDED_HOLDER_STEPS.map((step) => step.id), [
    "holder",
    "burners",
    "setup",
    "drop",
    "funding-review",
    "funding",
    "simulate",
    "mint",
    "receipts",
    "finish",
  ]);
  assert.equal(resolveGuidedHolderStep({ holder: false, burners: false, setup: false, drop: false, fundingReview: false, fundingComplete: false }), "holder");
  assert.equal(resolveGuidedHolderStep({ holder: true, burners: true, setup: false, drop: false, fundingReview: false, fundingComplete: false }), "setup");
  assert.equal(resolveGuidedHolderStep({ holder: true, burners: true, setup: true, drop: true, fundingReview: true, fundingComplete: false }), "funding");
  assert.equal(resolveGuidedHolderStep({ holder: true, burners: true, setup: true, drop: true, fundingReview: true, fundingComplete: true, simulationComplete: false, broadcastComplete: false, receiptsComplete: false }), "simulate");
});

test("projectGuidedBurners uses the canonical Vault public projection and filters to the drop chain", () => {
  const burners = projectGuidedBurners(vault, "base");

  assert.deepEqual(burners.map((wallet) => wallet.address), [BURNER_ONE, BURNER_TWO]);
  assert.equal(Object.hasOwn(burners[0], "privateKey"), false);
  assert.deepEqual(projectGuidedBurners(vault, "ethereum").map((wallet) => wallet.address), [ETH_BURNER]);
});

test("buildGuidedFundingReview calculates an exact holder-funded row for every canonical burner", () => {
  const plan = buildGuidedFundingReview({
    holder,
    discovery,
    burners: projectGuidedBurners(vault, "base"),
    quantityPerBurner: 2,
    mintGasLimit: BigInt(120_000),
    maxFeePerGasWei: BigInt(2_000_000_000),
    bufferBps: 500,
    maxTotalSourceWei: BigInt("220000000000000000"),
  });

  assert.equal(plan.mode, "review-only");
  assert.equal(plan.transactions.length, 2);
  assert.equal(plan.transactions[0].mintPriceWei, BigInt("100000000000000000"));
  assert.equal(plan.transactions[0].to, BURNER_ONE);
  assert.equal(plan.transactions[1].to, BURNER_TWO);
  assert.equal(plan.review.readyForFunding, true);
  assert.match(plan.review.warning, /explicit wallet confirmation.*each funding transaction/i);
});

test("buildGuidedMintSimulationPlan routes the recipient to the verified holder and requires exact live consent", () => {
  const preview = buildGuidedMintSimulationPlan({
    holder,
    discovery,
    vault,
    burnerAddresses: [BURNER_TWO],
    quantityPerBurner: 1,
    maxTotalValueWei: BigInt("50000000000000000"),
    mintGasLimit: 180_000,
    maxFeePerGasWei: BigInt(2_000_000_000),
  });

  assert.equal(preview.mode, "exact-bound-holder-run");
  assert.equal(preview.safety.automaticBroadcast, false);
  assert.equal(preview.safety.explicitConsentRequired, true);
  assert.equal(preview.plan.transactions.length, 1);
  assert.equal(preview.plan.transactions[0].walletAddress, BURNER_TWO);
  assert.equal(preview.plan.transactions.every((transaction) => transaction.recipientMode === "holder"), true);
  assert.equal(preview.plan.transactions.every((transaction) => transaction.recipientAddress === HOLDER), true);
  assert.equal(preview.plan.transactions.every((transaction) => transaction.walletAddress !== HOLDER), true);
  assert.equal(preview.plan.maxTotalWei, BigInt("50000000000000000"));
});

test("guided funding and simulation fail closed without an executable public stage", () => {
  const watchOnly = {
    ...discovery,
    stages: discovery.stages.map((stage) => ({ ...stage, source: "opensea-signed-preview" as const, feeRecipient: undefined })),
  };

  assert.throws(
    () => buildGuidedFundingReview({
      holder,
      discovery: watchOnly,
      burners: projectGuidedBurners(vault, "base"),
      quantityPerBurner: 1,
      mintGasLimit: BigInt(120_000),
      maxFeePerGasWei: BigInt(2_000_000_000),
      bufferBps: 500,
      maxTotalSourceWei: BigInt("220000000000000000"),
    }),
    /executable.*public.*SeaDrop/i,
  );
  assert.throws(() => buildGuidedMintSimulationPlan({
    holder,
    discovery: watchOnly,
    vault,
    quantityPerBurner: 1,
    maxTotalValueWei: BigInt("50000000000000000"),
    mintGasLimit: 180_000,
    maxFeePerGasWei: BigInt(2_000_000_000),
  }), /executable.*public.*SeaDrop/i);
});
