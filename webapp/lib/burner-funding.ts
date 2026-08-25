export type BurnerFundingChainKey = "ethereum" | "base" | "robinhood";

export interface VerifiedCompasFundingSource {
  address: string;
  compasCount: number;
  verifiedAt: number;
}

export interface BurnerFundingPlanInput {
  holder: VerifiedCompasFundingSource;
  chain: { key: BurnerFundingChainKey; chainId: number };
  burners: string[];
  mintPriceWei: bigint;
  mintGasLimit: bigint;
  maxFeePerGasWei: bigint;
  bufferBps: number;
  maxTotalSourceWei: bigint;
}

export interface BurnerFundingTransaction {
  id: string;
  index: number;
  from: string;
  to: string;
  chainId: number;
  mintPriceWei: bigint;
  mintGasWei: bigint;
  bufferWei: bigint;
  fundingValueWei: bigint;
  sourceTransferGasWei: bigint;
  sourceTotalWei: bigint;
  request: { from: string; to: string; value: string };
}

export interface BurnerFundingPlan {
  schemaVersion: "compas.burner-funding-plan.v1";
  mode: "review-only";
  source: VerifiedCompasFundingSource;
  chain: { key: BurnerFundingChainKey; chainId: number; name: string; nativeSymbol: "ETH" };
  transactions: BurnerFundingTransaction[];
  totals: Omit<BurnerFundingTransaction, "id" | "index" | "from" | "to" | "chainId" | "request">;
  review: {
    readyForFunding: boolean;
    checks: Array<{ id: string; label: string; ok: boolean; detail: string }>;
    warning: string;
  };
}

const CHAIN_NAMES: Record<BurnerFundingChainKey, string> = {
  ethereum: "Ethereum",
  base: "Base",
  robinhood: "Robinhood Chain",
};
const CHAIN_IDS: Record<BurnerFundingChainKey, number> = {
  ethereum: 1,
  base: 8453,
  robinhood: 4663,
};

const FUNDING_TRANSFER_GAS_LIMIT = BigInt(21_000);
const BPS_DENOMINATOR = BigInt(10_000);
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function buildBurnerFundingPlan(input: BurnerFundingPlanInput): BurnerFundingPlan {
  if (!Number.isInteger(input.holder.compasCount) || input.holder.compasCount < 1 || !Number.isFinite(input.holder.verifiedAt) || input.holder.verifiedAt <= 0) {
    throw new Error("Funding source must be a verified Compas holder session with at least one Compas.");
  }
  if (!ADDRESS_RE.test(input.holder.address)) throw new Error("Verified holder address is not a valid EVM address.");
  if (CHAIN_IDS[input.chain.key] !== input.chain.chainId) throw new Error(`Funding chain mismatch: ${input.chain.key} requires chain ID ${CHAIN_IDS[input.chain.key]}.`);
  if (input.mintPriceWei < BigInt(0)) throw new Error("Mint price must be zero or greater.");
  if (input.mintGasLimit <= BigInt(0)) throw new Error("Mint gas limit must be greater than zero.");
  if (input.maxFeePerGasWei <= BigInt(0)) throw new Error("Maximum fee per gas must be greater than zero.");
  if (!Number.isInteger(input.bufferBps) || input.bufferBps < 0 || input.bufferBps > 10_000) throw new Error("Funding buffer must be an integer from 0 to 10000 basis points.");
  if (input.maxTotalSourceWei <= BigInt(0)) throw new Error("Source spend cap must be greater than zero.");
  if (input.burners.length === 0) throw new Error("Add at least one burner recipient before building a funding plan.");
  const holderKey = input.holder.address.toLowerCase();
  const burnerKeys = new Set<string>();
  for (const burner of input.burners) {
    if (!ADDRESS_RE.test(burner)) throw new Error(`Burner address is not a valid EVM address: ${burner}`);
    const key = burner.toLowerCase();
    if (key === holderKey) throw new Error("A burner recipient must not be the holder funding source.");
    if (burnerKeys.has(key)) throw new Error(`Duplicate burner recipient: ${burner}`);
    burnerKeys.add(key);
  }

  const mintGasWei = input.mintGasLimit * input.maxFeePerGasWei;
  const subtotalWei = input.mintPriceWei + mintGasWei;
  const bufferWei = divideRoundUp(subtotalWei * BigInt(input.bufferBps), BPS_DENOMINATOR);
  const fundingValueWei = subtotalWei + bufferWei;
  const sourceTransferGasWei = FUNDING_TRANSFER_GAS_LIMIT * input.maxFeePerGasWei;
  const sourceTotalWei = fundingValueWei + sourceTransferGasWei;

  const transactions = input.burners.map((burner, index): BurnerFundingTransaction => ({
    id: `fund-burner-${index + 1}`,
    index,
    from: input.holder.address,
    to: burner,
    chainId: input.chain.chainId,
    mintPriceWei: input.mintPriceWei,
    mintGasWei,
    bufferWei,
    fundingValueWei,
    sourceTransferGasWei,
    sourceTotalWei,
    request: {
      from: input.holder.address,
      to: burner,
      value: toRpcQuantity(fundingValueWei),
    },
  }));

  const count = BigInt(transactions.length);
  const totals = {
    mintPriceWei: input.mintPriceWei * count,
    mintGasWei: mintGasWei * count,
    bufferWei: bufferWei * count,
    fundingValueWei: fundingValueWei * count,
    sourceTransferGasWei: sourceTransferGasWei * count,
    sourceTotalWei: sourceTotalWei * count,
  };

  return {
    schemaVersion: "compas.burner-funding-plan.v1",
    mode: "review-only",
    source: { ...input.holder },
    chain: { ...input.chain, name: CHAIN_NAMES[input.chain.key], nativeSymbol: "ETH" },
    transactions,
    totals,
    review: {
      readyForFunding: totals.sourceTotalWei <= input.maxTotalSourceWei,
      checks: [
        { id: "holder", label: "Verified Compas holder source", ok: input.holder.compasCount > 0, detail: input.holder.address },
        { id: "chain", label: "Funding chain", ok: true, detail: `${input.chain.key}:${input.chain.chainId}` },
        { id: "cap", label: "Source spend cap", ok: totals.sourceTotalWei <= input.maxTotalSourceWei, detail: `${totals.sourceTotalWei}/${input.maxTotalSourceWei} wei` },
      ],
      warning: "Review all recipients and amounts. The connected holder wallet must show an explicit wallet confirmation for each funding transaction; this plan never sends automatically.",
    },
  };
}

function divideRoundUp(value: bigint, divisor: bigint): bigint {
  return (value + divisor - BigInt(1)) / divisor;
}

function toRpcQuantity(value: bigint): string {
  return `0x${value.toString(16)}`;
}
