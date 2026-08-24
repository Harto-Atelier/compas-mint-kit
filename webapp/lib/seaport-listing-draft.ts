/**
 * Compas Seaport listing DRAFT builder — preview-only.
 *
 * Turns a Market Fighter ListingProposal into an UNSIGNED Seaport 1.6 order
 * parameters JSON plus a human-readable review summary. The holder must
 * review and sign the order manually in a separate flow.
 *
 * This module deliberately does NOT:
 *  - sign anything (no wallet/signer imports),
 *  - call any API or broadcast anything,
 *  - custody assets or accept secrets.
 *
 * All ETH -> wei math is exact BigInt arithmetic (no floating point in wei
 * math). Fee/royalty splits are computed in basis points; rounding dust is
 * assigned to the seller item so consideration amounts always sum exactly to
 * the total list price in wei.
 */

import { formatEther, keccak256, parseEther, toUtf8Bytes } from "ethers";
import type { ListingProposal } from "./market-fighter";

/**
 * Canonical cross-chain Seaport 1.6 deployment address.
 *
 * Verified 2026-08-24 against ProjectOpenSea/seaport `README.md` and
 * `docs/Deployment.md`, which list Seaport 1.6 at this address as the
 * canonical CREATE2 deployment on all supported EVM chains (Ethereum, Base,
 * Base Sepolia, etc.). Also matches the address in OpenSea's
 * "Introducing Seaport 1.6" announcement.
 */
export const SEAPORT_1_6_ADDRESS = "0x0000000000000068F116a894984e2DB1123eB395";

export const SEAPORT_LISTING_DRAFT_SCHEMA_VERSION = "compas-seaport-listing-draft.v1";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const MIN_DURATION_HOURS = 1;
const MAX_DURATION_HOURS = 720; // 30 days

/** Seaport ItemType 2 = ERC721 (offer side). ItemType 0 = NATIVE/ETH (consideration side). */
export interface SeaportOfferItem {
  itemType: 2;
  token: string;
  identifierOrCriteria: string;
  startAmount: "1";
  endAmount: "1";
}

export interface SeaportConsiderationItem {
  itemType: 0;
  token: string; // zero address for native ETH
  identifierOrCriteria: "0";
  startAmount: string; // wei, decimal string
  endAmount: string; // wei, decimal string
  recipient: string;
}

export interface SeaportOrderParameters {
  offerer: string;
  offer: SeaportOfferItem[];
  consideration: SeaportConsiderationItem[];
  startTime: string; // unix seconds, decimal string
  endTime: string; // unix seconds, decimal string
  orderType: 0; // FULL_OPEN
  zone: string;
  zoneHash: string;
  salt: string; // deterministic uint128 decimal string (see deriveDeterministicSalt)
  conduitKey: string;
  totalOriginalConsiderationItems: number;
}

export interface SeaportListingDraft {
  schemaVersion: typeof SEAPORT_LISTING_DRAFT_SCHEMA_VERSION;
  mode: "preview-only";
  safety: {
    previewOnly: true;
    signature: false;
    posted: false;
    custody: false;
    requiresManualSignature: true;
  };
  seaportAddress: string;
  chain: string;
  marketplace: ListingProposal["marketplace"];
  orderParameters: SeaportOrderParameters;
  reviewSummary: {
    tokenId: string;
    collectionAddress: string;
    listPriceEth: string;
    sellerReceivesEth: string;
    feeEth: string;
    royaltyEth: string;
    expiresAt: string; // ISO timestamp
  };
}

export interface BuildSeaportListingDraftInput {
  /** Must have status "suggested"; anything else (e.g. "blocked") throws fail-closed. */
  proposal: ListingProposal;
  /** Holder wallet that would sign later. 0x + 40 hex, validated. */
  offererAddress: string;
  /** Listing validity window in hours; clamped to 1..720. */
  durationHours: number;
  /** Marketplace fee recipient. Fee item only emitted when provided AND fee percent > 0. */
  feeRecipientAddress?: string;
  /** Fee percent (e.g. 2.5). Defaults to proposal.estimatedFeePercent when omitted. */
  feePercent?: number;
  /** Creator royalty recipient. Royalty item only emitted when provided AND royalty percent > 0. */
  royaltyRecipientAddress?: string;
  /** Royalty percent (e.g. 5). Defaults to 0 when omitted. */
  royaltyPercent?: number;
  /** Injectable clock for deterministic drafts in tests. */
  now?: Date;
}

export function buildSeaportListingDraft(input: BuildSeaportListingDraftInput): SeaportListingDraft {
  const proposal = input.proposal;

  // Fail closed: only explicitly suggested proposals can become drafts.
  if (proposal.status !== "suggested") {
    throw new Error(
      `Refusing to build Seaport draft: proposal status is "${proposal.status}" (must be "suggested").` +
        (proposal.blockedReasons.length ? ` Blocked reasons: ${proposal.blockedReasons.join("; ")}` : ""),
    );
  }
  if (proposal.marketplace !== "OpenSea/Seaport") {
    throw new Error(`Refusing to build Seaport draft for marketplace "${proposal.marketplace}".`);
  }

  const offerer = validateAddress(input.offererAddress, "offererAddress");
  const collection = validateAddress(proposal.collectionAddress, "proposal.collectionAddress");
  if (!/^\d+$/.test(proposal.tokenId)) {
    throw new Error(`proposal.tokenId must be a decimal token id, got "${proposal.tokenId}".`);
  }

  if (!Number.isFinite(proposal.suggestedListPriceEth) || proposal.suggestedListPriceEth <= 0) {
    throw new Error(`proposal.suggestedListPriceEth must be a finite positive number, got ${proposal.suggestedListPriceEth}.`);
  }
  // Proposal prices are rounded to 6 decimals upstream (market-fighter roundEth);
  // toFixed(12) is a safe fractional precision, then parseEther does the exact
  // decimal-string -> wei conversion. No float math touches wei from here on.
  const totalWei = parseEther(proposal.suggestedListPriceEth.toFixed(12));

  const feePercent = clampPercent(input.feePercent ?? proposal.estimatedFeePercent);
  const royaltyPercent = clampPercent(input.royaltyPercent ?? 0);

  const feeRecipient = input.feeRecipientAddress === undefined ? undefined : validateAddress(input.feeRecipientAddress, "feeRecipientAddress");
  const royaltyRecipient =
    input.royaltyRecipientAddress === undefined ? undefined : validateAddress(input.royaltyRecipientAddress, "royaltyRecipientAddress");

  const includeFee = feePercent > 0 && feeRecipient !== undefined;
  const includeRoyalty = royaltyPercent > 0 && royaltyRecipient !== undefined;

  // Basis points keep the split integral: 2.5% -> 250 bps. Exact BigInt division
  // floors each cut; the remainder (rounding dust) stays with the seller item so
  // the consideration sum equals totalWei exactly.
  const feeWei = includeFee ? (totalWei * BigInt(Math.round(feePercent * 100))) / BigInt(10_000) : BigInt(0);
  const royaltyWei = includeRoyalty ? (totalWei * BigInt(Math.round(royaltyPercent * 100))) / BigInt(10_000) : BigInt(0);
  const sellerWei = totalWei - feeWei - royaltyWei;
  if (sellerWei <= BigInt(0)) {
    throw new Error("Refusing to build Seaport draft: fee + royalty consume the entire list price.");
  }

  const now = input.now ?? new Date();
  const durationHours = clampDurationHours(input.durationHours);
  const startSeconds = Math.floor(now.getTime() / 1000);
  const endSeconds = startSeconds + durationHours * 3600;

  const consideration: SeaportConsiderationItem[] = [ethConsiderationItem(sellerWei, offerer)];
  if (includeFee && feeRecipient) consideration.push(ethConsiderationItem(feeWei, feeRecipient));
  if (includeRoyalty && royaltyRecipient) consideration.push(ethConsiderationItem(royaltyWei, royaltyRecipient));

  const salt = deriveDeterministicSalt([
    SEAPORT_LISTING_DRAFT_SCHEMA_VERSION,
    offerer,
    collection,
    proposal.tokenId,
    proposal.chain,
    totalWei.toString(),
    String(startSeconds),
    String(endSeconds),
  ]);

  return {
    schemaVersion: SEAPORT_LISTING_DRAFT_SCHEMA_VERSION,
    mode: "preview-only",
    safety: {
      previewOnly: true,
      signature: false,
      posted: false,
      custody: false,
      requiresManualSignature: true,
    },
    seaportAddress: SEAPORT_1_6_ADDRESS,
    chain: proposal.chain,
    marketplace: proposal.marketplace,
    orderParameters: {
      offerer,
      offer: [
        {
          itemType: 2,
          token: collection,
          identifierOrCriteria: proposal.tokenId,
          startAmount: "1",
          endAmount: "1",
        },
      ],
      consideration,
      startTime: String(startSeconds),
      endTime: String(endSeconds),
      orderType: 0,
      zone: ZERO_ADDRESS,
      zoneHash: ZERO_BYTES32,
      salt,
      conduitKey: ZERO_BYTES32,
      totalOriginalConsiderationItems: consideration.length,
    },
    reviewSummary: {
      tokenId: proposal.tokenId,
      collectionAddress: collection,
      listPriceEth: formatEther(totalWei),
      sellerReceivesEth: formatEther(sellerWei),
      feeEth: formatEther(feeWei),
      royaltyEth: formatEther(royaltyWei),
      expiresAt: new Date(endSeconds * 1000).toISOString(),
    },
  };
}

/**
 * Asserts the serialized draft contains no 64-hex private-key-shaped strings.
 * All-zero 32-byte values (zoneHash/conduitKey) are structural Seaport fields,
 * not secrets, and are explicitly allowed. Returns true when clean.
 */
export function validateDraftContainsNoSecrets(draft: unknown): true {
  const serialized = JSON.stringify(draft);
  if (serialized === undefined) throw new Error("Draft is not serializable.");
  const candidates = serialized.match(/(?:0x)?[0-9a-fA-F]{64,}/g) ?? [];
  for (const candidate of candidates) {
    const hex = candidate.startsWith("0x") ? candidate.slice(2) : candidate;
    if (hex.length !== 64) continue; // 40-hex addresses and longer digests are not key-shaped
    if (/^0+$/.test(hex)) continue; // 32-byte zero (zoneHash/conduitKey) is not a secret
    throw new Error("Draft contains a 64-hex private-key-shaped string; refusing to expose it.");
  }
  return true;
}

function ethConsiderationItem(amountWei: bigint, recipient: string): SeaportConsiderationItem {
  const amount = amountWei.toString();
  return {
    itemType: 0,
    token: ZERO_ADDRESS,
    identifierOrCriteria: "0",
    startAmount: amount,
    endAmount: amount,
    recipient,
  };
}

function validateAddress(value: string, label: string): string {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    throw new Error(`${label} must be a 0x-prefixed 40-hex address.`);
  }
  return value;
}

function clampDurationHours(value: number): number {
  if (!Number.isFinite(value)) throw new Error("durationHours must be a finite number.");
  return Math.min(MAX_DURATION_HOURS, Math.max(MIN_DURATION_HOURS, Math.floor(value)));
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(50, Math.max(0, value));
}

/**
 * Deterministic salt: keccak256 of the canonical input tuple, truncated to
 * 16 bytes (uint128) and rendered as a decimal string. Truncation keeps the
 * serialized draft free of 64-hex strings (which the no-secret validator
 * treats as private-key-shaped) while remaining a valid Seaport uint256 salt.
 * No randomness: identical inputs (including `now`) produce identical salts.
 */
function deriveDeterministicSalt(parts: string[]): string {
  const digest = keccak256(toUtf8Bytes(parts.join("|")));
  return BigInt(digest.slice(0, 34)).toString();
}
