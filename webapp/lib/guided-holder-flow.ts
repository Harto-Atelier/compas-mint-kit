import { JsonRpcProvider, parseEther } from "ethers";

import {
  buildBrowserMintPlan,
  hasPreparedBrowserMintSigner,
  reviewPreparedBrowserMintCalldata,
  type BrowserBroadcastChainKey,
  type BrowserMintPlan,
  type BrowserPreparedMint,
  type BrowserReceiptProviderLike,
  type GuidedMintReceipt,
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
  { id: "holder", label: "Connect" },
  { id: "burners", label: "Burners" },
  { id: "setup", label: "Setup" },
  { id: "drop", label: "Mint" },
  { id: "funding-review", label: "Confirm" },
  { id: "funding", label: "Fund" },
  { id: "simulate", label: "Check" },
  { id: "mint", label: "Launch" },
  { id: "receipts", label: "Receipt" },
  { id: "finish", label: "Finish" },
] as const;

export type GuidedHolderStepId = (typeof GUIDED_HOLDER_STEPS)[number]["id"];

export type GuidedHolderReadiness = {
  holder: boolean;
  burners: boolean;
  setup: boolean;
  drop: boolean;
  fundingReview: boolean;
  fundingComplete: boolean;
  simulationComplete?: boolean;
  broadcastComplete?: boolean;
  receiptsComplete?: boolean;
};

export type GuidedMintSimulationPlan = {
  mode: "exact-bound-holder-run";
  safety: {
    automaticBroadcast: false;
    explicitConsentRequired: true;
    recipient: "verified-compas-holder";
  };
  plan: BrowserMintPlan;
};

export function resolveGuidedHolderStep(readiness: GuidedHolderReadiness): GuidedHolderStepId {
  if (!readiness.holder) return "holder";
  if (!readiness.burners) return "burners";
  if (!readiness.setup) return "setup";
  if (!readiness.drop) return "drop";
  if (!readiness.fundingReview) return "funding-review";
  if (!readiness.fundingComplete) return "funding";
  if (!readiness.simulationComplete) return "simulate";
  if (!readiness.broadcastComplete) return "mint";
  if (!readiness.receiptsComplete) return "receipts";
  return "finish";
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
  mintGasLimit: number;
  maxFeePerGasWei: bigint;
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
    gasLimit: BigInt(input.mintGasLimit),
    maxFeePerGasWei: input.maxFeePerGasWei,
  });

  return {
    mode: "exact-bound-holder-run",
    safety: {
      automaticBroadcast: false,
      explicitConsentRequired: true,
      recipient: "verified-compas-holder",
    },
    plan,
  };
}

export type GuidedExecutionCapabilityCheck = {
  id: "drop" | "recipient" | "spend" | "signers" | "receipts";
  label: string;
  ok: boolean;
  detail: string;
};

export type GuidedExecutionCapabilities = {
  ready: boolean;
  planBinding: string;
  checks: GuidedExecutionCapabilityCheck[];
};

export async function checkGuidedExecutionCapabilities(input: {
  plan: BrowserMintPlan;
  holderAddress: string;
  burnerAddresses: readonly string[];
  mintValueMaxWei: bigint;
  provider?: BrowserReceiptProviderLike;
}): Promise<GuidedExecutionCapabilities> {
  const reviews = input.plan.transactions.map((transaction) => reviewPreparedBrowserMintCalldata(transaction, {
    holderRecipientAddress: input.holderAddress,
  }));
  const dropReady = input.plan.transactions.length > 0 && reviews.every((review) => (
    review.functionName === "mintPublic" && Boolean(review.nftContract)
  ));
  const recipientReady = input.plan.transactions.every((transaction) => (
    transaction.recipientMode === "holder" && transaction.recipientAddress.toLowerCase() === input.holderAddress.toLowerCase()
  ));
  const spendReady = input.plan.totalValueWei <= input.mintValueMaxWei && input.plan.maxTotalWei === input.mintValueMaxWei;
  const plannedBurners = input.plan.transactions.map((transaction) => transaction.walletAddress.toLowerCase()).sort();
  const expectedBurners = [...input.burnerAddresses].map((address) => address.toLowerCase()).sort();
  const signersReady = plannedBurners.length === expectedBurners.length &&
    plannedBurners.every((address, index) => address === expectedBurners[index]) &&
    input.plan.transactions.every(hasPreparedBrowserMintSigner);

  let receiptReady = false;
  let receiptDetail = "Receipt RPC checks were not completed.";
  try {
    const rpc = input.provider ?? (new JsonRpcProvider(input.plan.rpcUrl) as unknown as BrowserReceiptProviderLike);
    const network = await rpc.getNetwork();
    if (BigInt(network.chainId) !== BigInt(input.plan.chain.chainId)) {
      throw new Error(`receipt RPC chain ${network.chainId.toString()} does not match ${input.plan.chain.chainId}`);
    }
    await rpc.getBlockNumber();
    await rpc.getTransactionReceipt(`0x${"0".repeat(64)}`);
    for (const address of input.burnerAddresses) await rpc.getBalance(address);
    receiptReady = true;
    receiptDetail = `Chain ${input.plan.chain.chainId} supports block, receipt, and burner balance reads.`;
  } catch (error) {
    receiptDetail = error instanceof Error ? error.message : "Receipt and balance reads are unavailable.";
  }

  const checks: GuidedExecutionCapabilityCheck[] = [
    { id: "drop", label: "Executable drop is bound", ok: dropReady, detail: dropReady ? "Every row decodes to SeaDrop mintPublic for one collection." : "The exact drop calldata is unavailable." },
    { id: "recipient", label: "Verified holder recipient is bound", ok: recipientReady, detail: input.holderAddress },
    { id: "spend", label: "Maximum mint value is bound", ok: spendReady, detail: `${input.plan.totalValueWei}/${input.mintValueMaxWei} wei; network gas separate` },
    { id: "signers", label: "Selected burner signers remain in this run", ok: signersReady, detail: `${input.plan.transactions.length} exact bound signer row(s)` },
    { id: "receipts", label: "Receipt and balance verification is available", ok: receiptReady, detail: receiptDetail },
  ];
  return { ready: checks.every((check) => check.ok), planBinding: input.plan.binding, checks };
}

export type GuidedBurnerBalanceStatus = "zero" | "nonzero" | "unknown";
export type GuidedBurnerBalance = { address: string; balanceWei: bigint | null; status: GuidedBurnerBalanceStatus };

export async function readGuidedBurnerBalances(
  plan: BrowserMintPlan,
  provider?: BrowserReceiptProviderLike,
): Promise<Record<string, bigint | null>> {
  const rpc = provider ?? (new JsonRpcProvider(plan.rpcUrl) as unknown as BrowserReceiptProviderLike);
  const network = await rpc.getNetwork();
  if (BigInt(network.chainId) !== BigInt(plan.chain.chainId)) {
    throw new Error(`Burner balance RPC chain ${network.chainId.toString()} does not match the exact plan chain ${plan.chain.chainId}.`);
  }
  const balances: Record<string, bigint | null> = {};
  const addresses = [...new Set(plan.transactions.map((transaction) => transaction.walletAddress.toLowerCase()))];
  for (const address of addresses) {
    try {
      balances[address] = await rpc.getBalance(address);
    } catch {
      balances[address] = null;
    }
  }
  return balances;
}

export type GuidedFinishAssessment = {
  ready: boolean;
  blockers: string[];
  recovery: {
    required: boolean;
    mode: "manual-exact-sweep";
    recipient: string;
    burners: GuidedBurnerBalance[];
    instruction: string;
  };
};

export function assessGuidedFinish(input: {
  holderAddress: string;
  expectedTransactionCount: number;
  transactions: readonly BrowserPreparedMint[];
  receipts: readonly GuidedMintReceipt[];
  burnerBalances: Readonly<Record<string, bigint | null | undefined>>;
}): GuidedFinishAssessment {
  const blockers: string[] = [];
  if (!Number.isSafeInteger(input.expectedTransactionCount) || input.expectedTransactionCount < 1) {
    blockers.push("The bound run has no valid expected transaction count.");
  } else if (input.transactions.length !== input.expectedTransactionCount) {
    blockers.push(`Bound run expected ${input.expectedTransactionCount} transaction(s) but found ${input.transactions.length}.`);
  }
  for (const transaction of input.transactions) {
    if (transaction.status !== "broadcast" || !transaction.hash || !/^0x[0-9a-fA-F]{64}$/.test(transaction.hash)) {
      blockers.push(`${transaction.walletAlias}: transaction is not a submitted broadcast with a valid hash.`);
      continue;
    }
    const receipt = input.receipts.find((candidate) => (
      candidate.transactionId === transaction.id && candidate.binding === transaction.binding && candidate.hash.toLowerCase() === transaction.hash!.toLowerCase()
    ));
    const mismatchedReceipt = input.receipts.find((candidate) => (
      candidate.transactionId === transaction.id && candidate.binding === transaction.binding && candidate.hash.toLowerCase() !== transaction.hash!.toLowerCase()
    ));
    if (!receipt) {
      blockers.push(mismatchedReceipt
        ? `${transaction.walletAlias}: receipt hash does not match the submitted transaction hash.`
        : `${transaction.walletAlias}: receipt status is unknown.`);
    } else if (receipt.status !== "Confirmed") {
      blockers.push(`${transaction.walletAlias}: receipt status is ${receipt.status}.`);
    } else if (receipt.verifiedRecipient?.toLowerCase() !== input.holderAddress.toLowerCase()) {
      blockers.push(`${transaction.walletAlias}: confirmed receipt has no verified holder recipient.`);
    }
  }

  const recoveryBurners: GuidedBurnerBalance[] = [];
  const addresses = [...new Set(input.transactions.map((transaction) => transaction.walletAddress))];
  for (const address of addresses) {
    const balance = lookupBalance(input.burnerBalances, address);
    if (balance === undefined || balance === null) {
      blockers.push(`${address}: burner balance is unknown.`);
      recoveryBurners.push({ address, balanceWei: null, status: "unknown" });
    } else if (balance !== BigInt(0)) {
      blockers.push(`${address}: burner still holds ${balance} wei.`);
      recoveryBurners.push({ address, balanceWei: balance, status: "nonzero" });
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    recovery: {
      required: recoveryBurners.length > 0,
      mode: "manual-exact-sweep",
      recipient: input.holderAddress,
      burners: recoveryBurners,
      instruction: "Do not rotate or wipe this launch. Recover through the encrypted Vault: for each burner, re-read the exact balance, nonce, gas limit, and current fee; bind value = balance minus the reviewed maximum gas fee, simulate to the verified holder, consent once for that burner, send sequentially, verify its receipt, then verify the residual balance before continuing. Never auto-sweep or auto-retry.",
    },
  };
}

function lookupBalance(
  balances: Readonly<Record<string, bigint | null | undefined>>,
  address: string,
): bigint | null | undefined {
  const key = Object.keys(balances).find((candidate) => candidate.toLowerCase() === address.toLowerCase());
  return key ? balances[key] : undefined;
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
