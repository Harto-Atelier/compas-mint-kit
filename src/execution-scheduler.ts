import { parseRpcEndpoints } from "./rpc-blast";
import { maskRpc } from "./rpc-resolver";

export type ExecutionMode = "dry-run" | "broadcast-requested";
export type NonceStrategyKind = "provided-pending" | "rpc-pending" | "unknown";

export interface ExecutionChain {
  key: "ethereum" | "robinhood" | string;
  name: string;
  chainId: number;
  nativeSymbol: string;
}

export interface ExecutionWallet {
  alias: string;
  envVar: string;
  address: string;
}

export interface ExecutionTransactionTemplate {
  to: string;
  data: string;
  valueWei: bigint;
  gasLimit: number;
  maxFeePerGasWei: bigint;
  maxPriorityFeePerGasWei: bigint;
}

export interface RpcExecutionInput {
  queryEndpoint: string;
  broadcastEndpoints: string[];
}

export interface ExecutionNonceStrategy {
  strategy: NonceStrategyKind;
  startingNonces?: Record<string, number>;
  allowUnknown?: boolean;
  source?: string;
}

export interface ExecutionRateLimitPolicy {
  maxConcurrent: number;
  minDelayBetweenSubmissionsMs: number;
  batchCooldownMs: number;
}

export interface ExecutionRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  multiplier: number;
  retryableErrors: string[];
}

export interface ExecutionSchedulerInput {
  mode: ExecutionMode;
  chain: ExecutionChain;
  wallets: ExecutionWallet[];
  transaction: ExecutionTransactionTemplate;
  rpc: RpcExecutionInput;
  nonce: ExecutionNonceStrategy;
  rateLimit: ExecutionRateLimitPolicy;
  retry: ExecutionRetryPolicy;
}

export interface MaskedRpcEndpoint {
  url: string;
  maskedUrl: string;
  label: string;
}

export interface ExecutionTaskPlan {
  id: string;
  alias: string;
  envVar: string;
  address: string;
  chainId: number;
  txIndex: number;
  nonce: number | null;
  nonceSource: NonceStrategyKind;
  batchIndex: number;
  slotIndex: number;
  scheduledOffsetMs: number;
  retryScheduleMs: number[];
  rpcLabels: string[];
  transaction: ExecutionTransactionTemplate;
}

export interface ExecutionBatchEntry {
  alias: string;
  address: string;
  envVar: string;
  nonce: number | null;
  scheduledOffsetMs: number;
}

export interface ExecutionPlan {
  mode: ExecutionMode;
  broadcastEnabled: boolean;
  chain: ExecutionChain;
  rpc: {
    queryEndpoint: MaskedRpcEndpoint;
    broadcastEndpoints: MaskedRpcEndpoint[];
  };
  nonce: {
    strategy: NonceStrategyKind;
    source: string;
    unknownAllowed: boolean;
  };
  retry: ExecutionRetryPolicy;
  rateLimit: ExecutionRateLimitPolicy;
  concurrency: {
    width: number;
    batches: ExecutionBatchEntry[][];
  };
  tasks: ExecutionTaskPlan[];
  totals: {
    wallets: number;
    transactions: number;
    broadcastEndpoints: number;
    maxAttemptsPerTransaction: number;
    maxRpcSubmissions: number;
    finalScheduledOffsetMs: number;
  };
  safety: {
    dryRunOnly: boolean;
    keyMaterialLoaded: false;
    noBrowserKeys: true;
  };
}

export interface ExecutionBroadcaster {
  broadcast(rawTransaction: string, endpoints: MaskedRpcEndpoint[]): Promise<unknown>;
}

export interface DryRunExecutionReport {
  mode: "dry-run";
  broadcastInvoked: false;
  safetySummary: string;
  plan: unknown;
  tasks: Array<{
    alias: string;
    envVar: string;
    address: string;
    nonce: number | null;
    batchIndex: number;
    scheduledOffsetMs: number;
    retryScheduleMs: number[];
  }>;
  rpc: {
    queryEndpoint: Omit<MaskedRpcEndpoint, "url">;
    broadcastEndpoints: Array<Omit<MaskedRpcEndpoint, "url">>;
  };
}

export function buildExecutionPlan(input: ExecutionSchedulerInput): ExecutionPlan {
  if (input.wallets.length === 0) throw new Error("Execution plan requires at least one wallet.");
  if (input.rpc.broadcastEndpoints.length === 0) throw new Error("Execution plan requires at least one broadcast RPC endpoint.");

  const rateLimit = normalizeRateLimit(input.rateLimit, input.wallets.length);
  const retry = normalizeRetryPolicy(input.retry);
  const queryEndpoint = maskEndpoint(input.rpc.queryEndpoint, 0);
  const broadcastEndpoints = input.rpc.broadcastEndpoints.map(maskEndpoint);
  const retryScheduleMs = buildRetrySchedule(retry);

  const tasks: ExecutionTaskPlan[] = input.wallets.map((wallet, txIndex) => {
    const batchIndex = Math.floor(txIndex / rateLimit.maxConcurrent);
    const slotIndex = txIndex % rateLimit.maxConcurrent;
    const batchStartOffset = batchIndex * (rateLimit.maxConcurrent * rateLimit.minDelayBetweenSubmissionsMs + rateLimit.batchCooldownMs);
    const scheduledOffsetMs = batchStartOffset + slotIndex * rateLimit.minDelayBetweenSubmissionsMs;
    const nonce = resolveNonce(wallet, input.nonce);

    return {
      id: `${input.chain.key}:${wallet.alias}:${txIndex}`,
      alias: wallet.alias,
      envVar: wallet.envVar,
      address: wallet.address,
      chainId: input.chain.chainId,
      txIndex,
      nonce,
      nonceSource: input.nonce.strategy,
      batchIndex,
      slotIndex,
      scheduledOffsetMs,
      retryScheduleMs,
      rpcLabels: broadcastEndpoints.map((endpoint) => endpoint.label),
      transaction: input.transaction,
    };
  });

  const batches: ExecutionBatchEntry[][] = [];
  for (let i = 0; i < tasks.length; i += rateLimit.maxConcurrent) {
    batches.push(
      tasks.slice(i, i + rateLimit.maxConcurrent).map((task) => ({
        alias: task.alias,
        envVar: task.envVar,
        address: task.address,
        nonce: task.nonce,
        scheduledOffsetMs: task.scheduledOffsetMs,
      }))
    );
  }

  const finalScheduledOffsetMs = tasks.reduce((max, task) => Math.max(max, task.scheduledOffsetMs), 0);

  return {
    mode: input.mode,
    broadcastEnabled: input.mode === "broadcast-requested",
    chain: input.chain,
    rpc: {
      queryEndpoint,
      broadcastEndpoints,
    },
    nonce: {
      strategy: input.nonce.strategy,
      source: input.nonce.source ?? defaultNonceSource(input.nonce.strategy, queryEndpoint.label),
      unknownAllowed: input.nonce.allowUnknown === true,
    },
    retry,
    rateLimit,
    concurrency: {
      width: rateLimit.maxConcurrent,
      batches,
    },
    tasks,
    totals: {
      wallets: input.wallets.length,
      transactions: tasks.length,
      broadcastEndpoints: broadcastEndpoints.length,
      maxAttemptsPerTransaction: retry.maxAttempts,
      maxRpcSubmissions: tasks.length * broadcastEndpoints.length * retry.maxAttempts,
      finalScheduledOffsetMs,
    },
    safety: {
      dryRunOnly: input.mode === "dry-run",
      keyMaterialLoaded: false,
      noBrowserKeys: true,
    },
  };
}

export async function buildDryRunExecutionReport(
  plan: ExecutionPlan,
  _opts: { broadcaster?: ExecutionBroadcaster } = {}
): Promise<DryRunExecutionReport> {
  if (plan.mode !== "dry-run") {
    throw new Error("Dry-run execution reports require a dry-run plan.");
  }

  return {
    mode: "dry-run",
    broadcastInvoked: false,
    safetySummary: "Dry-run only: no transaction was signed or broadcast, no private key material was loaded, and browser keys are not used.",
    plan: toReportValue(plan),
    tasks: plan.tasks.map((task) => ({
      alias: task.alias,
      envVar: task.envVar,
      address: task.address,
      nonce: task.nonce,
      batchIndex: task.batchIndex,
      scheduledOffsetMs: task.scheduledOffsetMs,
      retryScheduleMs: task.retryScheduleMs,
    })),
    rpc: {
      queryEndpoint: withoutRawUrl(plan.rpc.queryEndpoint),
      broadcastEndpoints: plan.rpc.broadcastEndpoints.map(withoutRawUrl),
    },
  };
}

export function createNoopBroadcaster(
  broadcastImpl?: (rawTransaction: string, endpoints: MaskedRpcEndpoint[]) => Promise<unknown>
): ExecutionBroadcaster {
  return {
    async broadcast(rawTransaction: string, endpoints: MaskedRpcEndpoint[]): Promise<unknown> {
      if (!broadcastImpl) {
        throw new Error("Broadcast interface is configured but disabled for dry-run plans.");
      }
      return broadcastImpl(rawTransaction, endpoints);
    },
  };
}

function resolveNonce(wallet: ExecutionWallet, nonce: ExecutionNonceStrategy): number | null {
  const normalizedAddress = wallet.address.toLowerCase();
  const value = nonce.startingNonces?.[wallet.address] ?? nonce.startingNonces?.[normalizedAddress];
  if (value !== undefined) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid pending nonce for wallet ${wallet.alias}.`);
    return value;
  }
  if (nonce.allowUnknown || nonce.strategy === "unknown") return null;
  throw new Error(`Missing pending nonce for wallet ${wallet.alias} (${wallet.envVar}).`);
}

function normalizeRateLimit(rateLimit: ExecutionRateLimitPolicy, walletCount: number): ExecutionRateLimitPolicy {
  return {
    maxConcurrent: clampInteger(rateLimit.maxConcurrent, 1, Math.max(1, walletCount), "maxConcurrent"),
    minDelayBetweenSubmissionsMs: clampInteger(rateLimit.minDelayBetweenSubmissionsMs, 0, Number.MAX_SAFE_INTEGER, "minDelayBetweenSubmissionsMs"),
    batchCooldownMs: clampInteger(rateLimit.batchCooldownMs, 0, Number.MAX_SAFE_INTEGER, "batchCooldownMs"),
  };
}

function normalizeRetryPolicy(retry: ExecutionRetryPolicy): ExecutionRetryPolicy {
  return {
    maxAttempts: clampInteger(retry.maxAttempts, 1, 10, "maxAttempts"),
    baseDelayMs: clampInteger(retry.baseDelayMs, 0, Number.MAX_SAFE_INTEGER, "baseDelayMs"),
    multiplier: Math.max(1, retry.multiplier),
    retryableErrors: [...new Set(retry.retryableErrors.map((error) => error.trim()).filter(Boolean))],
  };
}

function buildRetrySchedule(retry: ExecutionRetryPolicy): number[] {
  const schedule: number[] = [];
  for (let attempt = 0; attempt < retry.maxAttempts; attempt++) {
    if (attempt === 0) {
      schedule.push(0);
    } else {
      schedule.push(Math.round(retry.baseDelayMs * retry.multiplier ** (attempt - 1)));
    }
  }
  return schedule;
}

function clampInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min) {
    throw new Error(`${label} must be an integer >= ${min}.`);
  }
  return Math.min(value, max);
}

function maskEndpoint(url: string, index: number): MaskedRpcEndpoint {
  const endpoint = parseRpcEndpoints([url])[0] ?? { label: `RPC[${index}]`, url };
  return {
    url,
    maskedUrl: maskRpc(url),
    label: endpoint.label,
  };
}

function defaultNonceSource(strategy: NonceStrategyKind, queryLabel: string): string {
  if (strategy === "provided-pending") return "provided pending nonce snapshot";
  if (strategy === "rpc-pending") return `pending nonce read from ${queryLabel}`;
  return "unknown nonce; signing/broadcast must resolve before send";
}

function withoutRawUrl(endpoint: MaskedRpcEndpoint): Omit<MaskedRpcEndpoint, "url"> {
  return {
    label: endpoint.label,
    maskedUrl: endpoint.maskedUrl,
  };
}

function toReportValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toReportValue);
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "url") continue;
    output[key] = toReportValue(child);
  }
  return output;
}
