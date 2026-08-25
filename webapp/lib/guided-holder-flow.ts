import { parseEther } from "ethers";

import {
  buildBrowserMintPlan,
  type BrowserBroadcastChainKey,
  type BrowserMintPlan,
  type UnlockedLaunchVault,
} from "./browser-broadcast";
import { buildBurnerFundingPlan, type BurnerFundingPlan } from "./burner-funding";
import type { CompasGateSession } from "./compas-gate";
import {
  toPublicLaunchWallet,
  type LaunchVaultPayload,
  type LaunchVaultPublicWallet,
} from "./encrypted-launch-vault";
import type { MintDiscoveryResponse, MintStage } from "./mint-types";

export const GUIDED_HOLDER_STEPS = [
  { id: "holder", label: "Holder" },
  { id: "burners", label: "Burners" },
  { id: "drop", label: "Drop" },
  { id: "funding-review", label: "Review" },
  { id: "funding", label: "Fund" },
  { id: "simulate", label: "Simulate" },
] as const;

export type GuidedHolderStepId = (typeof GUIDED_HOLDER_STEPS)[number]["id"];

export type GuidedHolderReadiness = {
  holder: boolean;
  burners: boolean;
  drop: boolean;
  fundingReview: boolean;
  fundingComplete: boolean;
};

export type GuidedMintSimulationPlan = {
  mode: "simulation-only";
  safety: {
    previewOnly: true;
    broadcast: false;
    custody: false;
    recipient: "verified-compas-holder";
  };
  plan: BrowserMintPlan;
};

export function resolveGuidedHolderStep(readiness: GuidedHolderReadiness): GuidedHolderStepId {
  if (!readiness.holder) return "holder";
  if (!readiness.burners) return "burners";
  if (!readiness.drop) return "drop";
  if (!readiness.fundingReview) return "funding-review";
  if (!readiness.fundingComplete) return "funding";
  return "simulate";
}

export function projectGuidedBurners(
  vault: LaunchVaultPayload,
  chainKey: string,
): LaunchVaultPublicWallet[] {
  const chain = requireSupportedChain(chainKey);
  const vaultChain = chain === "base" ? "Base" : "ETH";
  return vault.wallets
    .filter((wallet) => wallet.chain === vaultChain)
    .map(toPublicLaunchWallet);
}

export function buildGuidedFundingReview(input: {
  holder: CompasGateSession;
  discovery: MintDiscoveryResponse;
  burners: readonly LaunchVaultPublicWallet[];
  quantityPerBurner: number;
  mintGasLimit: bigint;
  maxFeePerGasWei: bigint;
  bufferBps: number;
  maxTotalSourceWei: bigint;
}): BurnerFundingPlan {
  const chain = requireSupportedChain(input.discovery.collection.chain.key);
  const stage = requireExecutablePublicStage(input.discovery);
  const quantity = requireQuantity(input.quantityPerBurner, stage);
  const expectedVaultChain = chain === "base" ? "Base" : "ETH";
  const burners = input.burners.filter((wallet) => wallet.chain === expectedVaultChain);
  if (burners.length === 0) {
    throw new Error(`Create at least one encrypted ${expectedVaultChain} burner in the canonical launch Vault before reviewing funding.`);
  }

  return buildBurnerFundingPlan({
    holder: input.holder,
    chain: { key: chain, chainId: input.discovery.collection.chain.chainId },
    burners: burners.map((wallet) => wallet.address),
    mintPriceWei: parseEther(stage.priceEth) * BigInt(quantity),
    mintGasLimit: input.mintGasLimit,
    maxFeePerGasWei: input.maxFeePerGasWei,
    bufferBps: input.bufferBps,
    maxTotalSourceWei: input.maxTotalSourceWei,
  });
}

export function buildGuidedMintSimulationPlan(input: {
  holder: CompasGateSession;
  discovery: MintDiscoveryResponse;
  vault: LaunchVaultPayload;
  burnerAddresses?: readonly string[];
  quantityPerBurner: number;
  maxTotalValueWei: bigint;
  rpcUrl?: string;
  seaDropAddress?: string;
}): GuidedMintSimulationPlan {
  const chain = requireSupportedChain(input.discovery.collection.chain.key);
  const stage = requireExecutablePublicStage(input.discovery);
  const quantity = requireQuantity(input.quantityPerBurner, stage);
  const vaultChain = chain === "base" ? "Base" : "ETH";
  const selectedAddresses = input.burnerAddresses
    ? new Set(input.burnerAddresses.map((address) => address.toLowerCase()))
    : null;
  const wallets = input.vault.wallets.filter((wallet) =>
    wallet.chain === vaultChain && (!selectedAddresses || selectedAddresses.has(wallet.address.toLowerCase())),
  );
  if (wallets.length === 0) {
    throw new Error(`Unlock a canonical launch Vault with at least one ${vaultChain} burner before simulation.`);
  }

  const unlockedVault: UnlockedLaunchVault = {
    status: "unlocked",
    unlockedAt: new Date().toISOString(),
    wallets: wallets.map((wallet) => ({
      alias: wallet.label,
      address: wallet.address,
      chain: wallet.chain,
      privateKey: wallet.privateKey,
    })),
  };
  const plan = buildBrowserMintPlan({
    chainKey: chain,
    collectionAddress: input.discovery.collection.address,
    stages: [{
      id: stage.id,
      label: stage.label,
      source: stage.source,
      quantity,
      priceEth: stage.priceEth,
      feeRecipient: stage.feeRecipient,
    }],
    walletCount: wallets.length,
    vault: unlockedVault,
    rpcUrl: input.rpcUrl,
    seaDropAddress: input.seaDropAddress,
    recipientMode: "holder",
    holderRecipientAddress: input.holder.address,
    maxTotalValueWei: input.maxTotalValueWei,
  });

  return {
    mode: "simulation-only",
    safety: {
      previewOnly: true,
      broadcast: false,
      custody: false,
      recipient: "verified-compas-holder",
    },
    plan,
  };
}

export function requireExecutablePublicStage(discovery: MintDiscoveryResponse): MintStage {
  const stage = discovery.stages.find((candidate) =>
    candidate.id === "public" &&
    candidate.source === "onchain-seadrop" &&
    Boolean(candidate.feeRecipient),
  );
  if (!stage) {
    throw new Error("This drop has no executable public SeaDrop stage. Signed, allowlist, and mock stages stay review-only.");
  }
  return stage;
}

function requireSupportedChain(chainKey: string): BrowserBroadcastChainKey {
  if (chainKey === "ethereum" || chainKey === "base") return chainKey;
  throw new Error(`Unsupported guided funding chain: ${chainKey}`);
}

function requireQuantity(quantity: number, stage: MintStage): number {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("Quantity per burner must be a positive whole number.");
  }
  if (stage.maxPerWallet !== null && quantity > stage.maxPerWallet) {
    throw new Error(`Quantity per burner exceeds the public stage cap of ${stage.maxPerWallet}.`);
  }
  return quantity;
}
