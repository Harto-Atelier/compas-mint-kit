import assert from "node:assert/strict";
import test from "node:test";
import { parseEther } from "ethers";
import type { ListingProposal } from "./market-fighter";
import { buildSeaportListingDraft, validateDraftContainsNoSecrets } from "./seaport-listing-draft";

const offererAddress = "0x1111111111111111111111111111111111111111";
const feeRecipientAddress = "0x2222222222222222222222222222222222222222";
const royaltyRecipientAddress = "0x3333333333333333333333333333333333333333";
const now = new Date("2026-08-24T12:00:00.000Z");

function suggestedProposal(overrides: Partial<ListingProposal> = {}): ListingProposal {
  return {
    status: "suggested",
    tokenId: "42",
    collectionAddress: "0x4444444444444444444444444444444444444444",
    chain: "Base",
    costBasisEth: 0.05,
    targetProfitPercent: 25,
    estimatedFeePercent: 2.5,
    suggestedListPriceEth: 0.123456,
    minNetProceedsEth: 0.05,
    netAfterFeesEth: 0.114197,
    estimatedProfitEth: 0.064197,
    marketplace: "OpenSea/Seaport",
    nextStep: "manual-listing-review",
    blockedReasons: [],
    ...overrides,
  };
}

test("suggested proposal builds a preview-only unsigned Seaport draft with exact wei consideration sum", () => {
  const proposal = suggestedProposal();
  const draft = buildSeaportListingDraft({
    proposal,
    offererAddress,
    durationHours: 24,
    feeRecipientAddress,
    royaltyRecipientAddress,
    royaltyPercent: 5,
    now,
  });

  assert.equal(draft.schemaVersion, "compas-seaport-listing-draft.v1");
  assert.equal(draft.mode, "preview-only");
  assert.deepEqual(draft.safety, {
    previewOnly: true,
    signature: false,
    posted: false,
    custody: false,
    requiresManualSignature: true,
  });
  assert.equal(draft.orderParameters.offerer, offererAddress);
  assert.deepEqual(draft.orderParameters.offer, [
    {
      itemType: 2,
      token: proposal.collectionAddress,
      identifierOrCriteria: proposal.tokenId,
      startAmount: "1",
      endAmount: "1",
    },
  ]);

  const considerationSum = draft.orderParameters.consideration.reduce(
    (sum, item) => sum + BigInt(item.startAmount),
    BigInt(0),
  );
  assert.equal(considerationSum, parseEther(proposal.suggestedListPriceEth.toFixed(12)));
  assert.equal(draft.orderParameters.totalOriginalConsiderationItems, draft.orderParameters.consideration.length);
  assert.equal(draft.orderParameters.consideration.length, 3);
  assert.equal(draft.reviewSummary.listPriceEth, "0.123456");
  assert.equal(draft.reviewSummary.expiresAt, "2026-08-25T12:00:00.000Z");
});

test("blocked proposal throws fail-closed", () => {
  const proposal = suggestedProposal({
    status: "blocked",
    nextStep: "hold",
    blockedReasons: ["bot pressure too high"],
  });
  assert.throws(
    () => buildSeaportListingDraft({ proposal, offererAddress, durationHours: 24, now }),
    /proposal status is "blocked"/,
  );
});

test("duration clamps to 1..720 hours", () => {
  const proposal = suggestedProposal();
  const startSeconds = Math.floor(now.getTime() / 1000);

  const minDraft = buildSeaportListingDraft({ proposal, offererAddress, durationHours: 0, now });
  assert.equal(Number(minDraft.orderParameters.endTime) - startSeconds, 3600);
  assert.equal(minDraft.reviewSummary.expiresAt, "2026-08-24T13:00:00.000Z");

  const maxDraft = buildSeaportListingDraft({ proposal, offererAddress, durationHours: 999, now });
  assert.equal(Number(maxDraft.orderParameters.endTime) - startSeconds, 720 * 3600);
  assert.equal(maxDraft.reviewSummary.expiresAt, "2026-09-23T12:00:00.000Z");
});

test("fee and royalty items only appear when percents are positive and recipients are provided", () => {
  const proposal = suggestedProposal({ estimatedFeePercent: 0 });

  const sellerOnly = buildSeaportListingDraft({
    proposal,
    offererAddress,
    durationHours: 24,
    royaltyPercent: 5,
    now,
  });
  assert.equal(sellerOnly.orderParameters.consideration.length, 1);
  assert.equal(sellerOnly.reviewSummary.feeEth, "0.0");
  assert.equal(sellerOnly.reviewSummary.royaltyEth, "0.0");

  const withFeeOnly = buildSeaportListingDraft({
    proposal: suggestedProposal({ estimatedFeePercent: 2.5 }),
    offererAddress,
    durationHours: 24,
    feeRecipientAddress,
    royaltyPercent: 5,
    now,
  });
  assert.equal(withFeeOnly.orderParameters.consideration.length, 2);
  assert.equal(withFeeOnly.orderParameters.consideration[1]?.recipient, feeRecipientAddress);
  assert.notEqual(withFeeOnly.reviewSummary.feeEth, "0.0");
  assert.equal(withFeeOnly.reviewSummary.royaltyEth, "0.0");

  const withRoyaltyOnly = buildSeaportListingDraft({
    proposal,
    offererAddress,
    durationHours: 24,
    royaltyRecipientAddress,
    royaltyPercent: 5,
    now,
  });
  assert.equal(withRoyaltyOnly.orderParameters.consideration.length, 2);
  assert.equal(withRoyaltyOnly.orderParameters.consideration[1]?.recipient, royaltyRecipientAddress);
  assert.equal(withRoyaltyOnly.reviewSummary.feeEth, "0.0");
  assert.notEqual(withRoyaltyOnly.reviewSummary.royaltyEth, "0.0");
});

test("salt is deterministic with a fixed clock", () => {
  const proposal = suggestedProposal();
  const input = {
    proposal,
    offererAddress,
    durationHours: 24,
    feeRecipientAddress,
    royaltyRecipientAddress,
    royaltyPercent: 5,
    now,
  };

  const first = buildSeaportListingDraft(input);
  const second = buildSeaportListingDraft(input);
  assert.equal(first.orderParameters.salt, second.orderParameters.salt);

  const differentDuration = buildSeaportListingDraft({ ...input, durationHours: 25 });
  assert.notEqual(first.orderParameters.salt, differentDuration.orderParameters.salt);
});

test("no-secret validation passes for a normal draft", () => {
  const draft = buildSeaportListingDraft({
    proposal: suggestedProposal(),
    offererAddress,
    durationHours: 24,
    feeRecipientAddress,
    royaltyRecipientAddress,
    royaltyPercent: 5,
    now,
  });
  assert.equal(validateDraftContainsNoSecrets(draft), true);
});
