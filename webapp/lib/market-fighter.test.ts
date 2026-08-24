import assert from "node:assert/strict";
import test from "node:test";
import { buildListingProposal, buildMarketFighterPlan, computeBotPressure, defaultMarketFighterPolicy, type HolderPosition } from "./market-fighter";

const holderPosition: HolderPosition = {
  tokenId: "42",
  collectionAddress: "0x1111111111111111111111111111111111111111",
  chain: "Base",
  costBasisEth: 0.04,
  acquiredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  status: "held",
};

test("Market Fighter listing proposal suggests price that clears target profit after fees", () => {
  const policy = { ...defaultMarketFighterPolicy(), allowedChains: ["Base"], targetProfitPercent: 25, minListEth: 0.01, minNetProceedsEth: 0.045 };
  const pressure = computeBotPressure({ freshWalletMintPercent: 10, rapidListingPercent: 5, undercutVelocityPercent: 10 });
  const proposal = buildListingProposal({ position: holderPosition, policy, botPressure: pressure });
  assert.equal(proposal.status, "suggested");
  assert.equal(proposal.nextStep, "manual-listing-review");
  assert.ok(proposal.netAfterFeesEth >= policy.minNetProceedsEth);
  assert.ok(proposal.estimatedProfitEth > 0);
});

test("Market Fighter blocks listing when bot pressure exceeds ceiling", () => {
  const policy = { ...defaultMarketFighterPolicy(), allowedChains: ["Base"], botPressureCeiling: 30 };
  const pressure = computeBotPressure({ freshWalletMintPercent: 90, rapidListingPercent: 80, undercutVelocityPercent: 70 });
  assert.equal(pressure.band, "high");
  const proposal = buildListingProposal({ position: holderPosition, policy, botPressure: pressure });
  assert.equal(proposal.status, "blocked");
  assert.match(proposal.blockedReasons.join(" "), /bot pressure/);
});

test("Market Fighter refuses auto-list-locked mode and stays preview-only", () => {
  const policy = { ...defaultMarketFighterPolicy(), allowedChains: ["Base"], sellMode: "auto-list-locked" as const };
  const plan = buildMarketFighterPlan({
    positions: [holderPosition],
    policy,
    pressureInput: { freshWalletMintPercent: 10, rapidListingPercent: 10, undercutVelocityPercent: 10 },
  });
  assert.equal(plan.safety.listingSignature, false);
  assert.equal(plan.safety.autoListing, false);
  assert.equal(plan.proposals[0].status, "blocked");
  assert.equal(JSON.stringify(plan).includes("privateKey"), false);
});

test("Market Fighter enforces min hold time before proposing a listing", () => {
  const freshPosition: HolderPosition = { ...holderPosition, acquiredAt: new Date().toISOString() };
  const policy = { ...defaultMarketFighterPolicy(), allowedChains: ["Base"], minHoldMinutes: 30 };
  const pressure = computeBotPressure({ freshWalletMintPercent: 10, rapidListingPercent: 10, undercutVelocityPercent: 10 });
  const proposal = buildListingProposal({ position: freshPosition, policy, botPressure: pressure });
  assert.equal(proposal.status, "blocked");
  assert.match(proposal.blockedReasons.join(" "), /min hold/);
});
