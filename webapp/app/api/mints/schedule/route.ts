import { getAddress, isAddress } from "ethers";
import { buildLocalCliCommand, buildRunConfigFilename } from "@/lib/run-config";
import type { FinalProductChainKey, MintStage, RpcReadinessStatus, ScheduleError, ScheduleRequest, ScheduleResponse } from "@/lib/mint-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PREVIEW_WALLETS = 20;
const MAX_REQUEST_BYTES = 64_000;
const MAX_FEE_GWEI = 10_000;
const FINAL_PRODUCT_CHAINS: FinalProductChainKey[] = ["ethereum", "robinhood"];
const RPC_STATUSES: RpcReadinessStatus[] = ["unchecked", "ready", "blocked"];

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) throw new Error("Schedule preview request is too large.");
    const body = (await request.json()) as Partial<ScheduleRequest>;
    const schedule = buildSchedule(body);
    return Response.json(schedule, { status: 201 });
  } catch (error) {
    const body: ScheduleError = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    return Response.json(body, { status: 400 });
  }
}

function buildSchedule(body: Partial<ScheduleRequest>): ScheduleResponse {
  if (!body.collection?.address) throw new Error("Missing collection.");
  if (!body.stages || body.stages.length === 0) throw new Error("No mint stages supplied.");
  if (!body.quantities || body.quantities.length === 0) throw new Error("Select at least one stage quantity.");

  const walletCount = clampInteger(body.walletCount ?? 0, 1, MAX_PREVIEW_WALLETS, "wallet count");
  const maxFeeGwei = boundedNumber(body.maxFeeGwei, 0, MAX_FEE_GWEI, "max fee");
  const gasLimit = clampInteger(body.gasLimit ?? 0, 21_000, 2_000_000, "gas limit");
  const warnings: string[] = ["Preview schedule only: the webapp never signs or broadcasts transactions."];

  const drainAddress = cleanDrainAddress(body.drainAddress);
  if (body.drainAddress && !drainAddress) throw new Error("Sweep destination must be a valid 0x address.");
  if (drainAddress) {
    warnings.push("Sweep destination is preview metadata only: this route cannot move, drain, or sweep funds.");
  }

  const selectedStages = body.quantities
    .map((quantity) => {
      const stage = body.stages?.find((candidate) => candidate.id === quantity.stageId);
      if (!stage) return null;
      const selectedQuantity = clampInteger(quantity.quantity, 0, 100, stage.label);
      if (selectedQuantity === 0) return null;
      return {
        stageId: stage.id,
        label: stage.label,
        quantity: selectedQuantity,
        fireAt: stage.startTime,
        source: stage.source,
      };
    })
    .filter((stage): stage is NonNullable<typeof stage> => stage !== null);

  if (selectedStages.length === 0) throw new Error("Set a quantity above zero for at least one stage.");

  for (const stage of selectedStages) {
    const original = body.stages.find((candidate) => candidate.id === stage.stageId) as MintStage;
    if (original.maxPerWallet !== null && stage.quantity > original.maxPerWallet) {
      warnings.push(`${original.label} quantity ${stage.quantity} exceeds max ${original.maxPerWallet} per wallet and may revert.`);
    }
    if (original.source !== "onchain-seadrop") {
      warnings.push(`${original.label} is ${original.source}; it requires wallet-specific signed calldata outside this preview.`);
    }
    if (original.status === "ended") {
      warnings.push(`${original.label} appears ended; keep it for audit only.`);
    }
  }

  const mintEth = selectedStages.reduce((sum, selected) => {
    const stage = body.stages?.find((candidate) => candidate.id === selected.stageId);
    return sum + boundedNumber(stage?.priceEth || 0, 0, 10_000, stage?.label ?? "stage price") * selected.quantity * walletCount;
  }, 0);
  const gasCeilingEth = (gasLimit * maxFeeGwei * 1e-9) * walletCount * selectedStages.length;
  const fireAt = selectedStages
    .map((stage) => stage.fireAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
  const finalProduct = normalizeFinalProduct(body, walletCount, mintEth + gasCeilingEth, warnings);

  return {
    ok: true,
    scheduleId: `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    canBroadcast: false,
    fireAt,
    walletsUsed: walletCount,
    selectedStages,
    totals: {
      mintEth: formatEth(mintEth),
      gasCeilingEth: formatEth(gasCeilingEth),
      grandTotalEth: formatEth(mintEth + gasCeilingEth),
    },
    drainAddress: drainAddress || undefined,
    finalProduct,
    warnings,
  };
}

function normalizeFinalProduct(
  body: Partial<ScheduleRequest>,
  walletCount: number,
  estimatedTotalEth: number,
  warnings: string[],
): ScheduleResponse["finalProduct"] {
  const fallbackChain = FINAL_PRODUCT_CHAINS.includes(body.collection?.chain.key as FinalProductChainKey)
    ? (body.collection?.chain.key as FinalProductChainKey)
    : "ethereum";
  const controls = body.finalProduct;
  const targetChainKey = FINAL_PRODUCT_CHAINS.includes(controls?.targetChainKey as FinalProductChainKey)
    ? (controls?.targetChainKey as FinalProductChainKey)
    : fallbackChain;
  const rpcStatus = RPC_STATUSES.includes(controls?.rpcStatus as RpcReadinessStatus)
    ? (controls?.rpcStatus as RpcReadinessStatus)
    : "unchecked";
  const maxSpendEth = boundedNumber(controls?.maxSpendEth ?? Math.max(estimatedTotalEth, 0.000001), 0.000001, 10_000, "max spend cap");
  if (maxSpendEth < estimatedTotalEth) {
    throw new Error(`Max spend cap ${maxSpendEth} ETH is below estimated total ${formatEth(estimatedTotalEth)} ETH.`);
  }
  const concurrency = clampInteger(controls?.concurrency ?? walletCount, 1, walletCount, "concurrency");
  const filename = buildRunConfigFilename(body.collection?.slug || body.collection?.name || "mint", targetChainKey);

  if (body.collection?.chain.key !== targetChainKey) {
    warnings.push(`Target chain ${targetChainKey} differs from discovered collection chain ${body.collection?.chain.key}; verify locally before execution.`);
  }
  if (rpcStatus !== "ready") warnings.push(`RPC status is ${rpcStatus}; local CLI dry-run must verify chain ID and connectivity before any live path.`);

  return {
    targetChainKey,
    rpcStatus,
    maxSpendEth,
    concurrency,
    walletAliasCount: walletCount,
    localCliCommand: buildLocalCliCommand(filename),
  };
}

function boundedNumber(value: unknown, min: number, max: number, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`Invalid ${label}; expected ${min}-${max}.`);
  return number;
}

function clampInteger(value: unknown, min: number, max: number, label: string): number {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`Invalid ${label}; expected ${min}-${max}.`);
  }
  return number;
}

function cleanDrainAddress(value?: string): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (!isAddress(raw)) return null;
  return getAddress(raw);
}

function formatEth(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 4,
    useGrouping: false,
  });
}
