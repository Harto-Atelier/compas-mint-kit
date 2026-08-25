import assert from "node:assert/strict";
import test from "node:test";

import { buildBurnerFundingPlan } from "./burner-funding";

const HOLDER = "0x1111111111111111111111111111111111111111";
const BURNER_ONE = "0x2222222222222222222222222222222222222222";
const BURNER_TWO = "0x3333333333333333333333333333333333333333";

function validInput() {
  return {
    holder: { address: HOLDER, compasCount: 2, verifiedAt: 1_777_000_000_000 },
    chain: { key: "base" as const, chainId: 8453 },
    burners: [BURNER_ONE, BURNER_TWO],
    mintPriceWei: BigInt("50000000000000000"),
    mintGasLimit: BigInt("120000"),
    maxFeePerGasWei: BigInt("2000000000"),
    bufferBps: 500,
    maxTotalSourceWei: BigInt("106000000000000000"),
  };
}

test("buildBurnerFundingPlan calculates mint, gas, buffer, transfer gas, and explicit review totals", () => {
  const plan = buildBurnerFundingPlan(validInput());

  assert.equal(plan.schemaVersion, "compas.burner-funding-plan.v1");
  assert.equal(plan.mode, "review-only");
  assert.deepEqual(plan.source, { address: HOLDER, compasCount: 2, verifiedAt: 1_777_000_000_000 });
  assert.deepEqual(plan.chain, { key: "base", chainId: 8453, name: "Base", nativeSymbol: "ETH" });
  assert.equal(plan.transactions.length, 2);
  assert.deepEqual(plan.transactions[0], {
    id: "fund-burner-1",
    index: 0,
    from: HOLDER,
    to: BURNER_ONE,
    chainId: 8453,
    mintPriceWei: BigInt("50000000000000000"),
    mintGasWei: BigInt("240000000000000"),
    bufferWei: BigInt("2512000000000000"),
    fundingValueWei: BigInt("52752000000000000"),
    sourceTransferGasWei: BigInt("42000000000000"),
    sourceTotalWei: BigInt("52794000000000000"),
    request: {
      from: HOLDER,
      to: BURNER_ONE,
      value: "0xbb69aa1d310000",
    },
  });
  assert.deepEqual(plan.totals, {
    mintPriceWei: BigInt("100000000000000000"),
    mintGasWei: BigInt("480000000000000"),
    bufferWei: BigInt("5024000000000000"),
    fundingValueWei: BigInt("105504000000000000"),
    sourceTransferGasWei: BigInt("84000000000000"),
    sourceTotalWei: BigInt("105588000000000000"),
  });
  assert.equal(plan.review.readyForFunding, true);
  assert.equal(plan.review.checks.every((check) => check.ok), true);
  assert.match(plan.review.warning, /wallet confirmation.*each funding transaction/i);
});

test("buildBurnerFundingPlan rejects an unverified or non-holder funding source", () => {
  const noCompas = { ...validInput(), holder: { address: HOLDER, compasCount: 0, verifiedAt: 1_777_000_000_000 } };
  const noVerification = { ...validInput(), holder: { address: HOLDER, compasCount: 2, verifiedAt: 0 } };

  assert.throws(() => buildBurnerFundingPlan(noCompas), /verified Compas holder/i);
  assert.throws(() => buildBurnerFundingPlan(noVerification), /verified Compas holder/i);
});

test("buildBurnerFundingPlan rejects invalid, duplicate, empty, or source-matching burner addresses", () => {
  assert.throws(() => buildBurnerFundingPlan({ ...validInput(), holder: { ...validInput().holder, address: "0xnope" } }), /holder address/i);
  assert.throws(() => buildBurnerFundingPlan({ ...validInput(), burners: [] }), /at least one burner/i);
  assert.throws(() => buildBurnerFundingPlan({ ...validInput(), burners: ["0xnope"] }), /burner address/i);
  assert.throws(() => buildBurnerFundingPlan({ ...validInput(), burners: [BURNER_ONE, BURNER_ONE.toUpperCase().replace("0X", "0x")] }), /duplicate burner/i);
  assert.throws(() => buildBurnerFundingPlan({ ...validInput(), burners: [HOLDER] }), /must not be the holder/i);
});

test("buildBurnerFundingPlan fails closed on chain mismatch and unsafe numeric inputs", () => {
  assert.throws(() => buildBurnerFundingPlan({ ...validInput(), chain: { key: "base", chainId: 1 } }), /chain.*mismatch/i);
  assert.throws(() => buildBurnerFundingPlan({ ...validInput(), mintPriceWei: BigInt(-1) }), /mint price/i);
  assert.throws(() => buildBurnerFundingPlan({ ...validInput(), mintGasLimit: BigInt(0) }), /gas limit/i);
  assert.throws(() => buildBurnerFundingPlan({ ...validInput(), maxFeePerGasWei: BigInt(0) }), /fee per gas/i);
  assert.throws(() => buildBurnerFundingPlan({ ...validInput(), bufferBps: 10_001 }), /buffer/i);
  assert.throws(() => buildBurnerFundingPlan({ ...validInput(), maxTotalSourceWei: BigInt(0) }), /cap/i);
});

test("buildBurnerFundingPlan returns a blocked review when total source cost exceeds the cap", () => {
  const plan = buildBurnerFundingPlan({ ...validInput(), maxTotalSourceWei: BigInt("105587999999999999") });

  assert.equal(plan.review.readyForFunding, false);
  assert.equal(plan.review.checks.find((check) => check.id === "cap")?.ok, false);
  assert.match(plan.review.checks.find((check) => check.id === "cap")?.detail ?? "", /105588000000000000/);
  assert.equal(plan.transactions.length, 2, "blocked reviews retain recipient rows for human inspection");
});
