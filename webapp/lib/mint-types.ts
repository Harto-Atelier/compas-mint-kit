export type StageKind = "team" | "gtd" | "fcfs" | "public";
export type StageSource = "onchain-seadrop" | "opensea-signed-preview" | "mock-preview";
export type StageStatus = "ended" | "live" | "upcoming" | "unknown";
export type FinalProductChainKey = "ethereum" | "robinhood";
export type RpcReadinessStatus = "unchecked" | "ready" | "blocked";
export type ExecutionMode = "planner-only" | "encrypted-browser";
export type ScheduleWalletSource = "imported" | "vault";

export interface ScheduleWallet {
  alias: string;
  address: string;
  source: ScheduleWalletSource;
  encryptedVault: boolean;
  unlockedForExecution: boolean;
}

export interface FinalProductControls {
  targetChainKey: FinalProductChainKey;
  rpcStatus: RpcReadinessStatus;
  maxSpendEth: number;
  concurrency: number;
  executionMode: ExecutionMode;
}

export interface ChainOption {
  key: string;
  name: string;
  chainId: number;
  explorer: string;
  nativeSymbol: string;
}

export interface CollectionCard {
  name: string;
  slug?: string;
  imageUrl?: string;
  description?: string;
  address: string;
  chain: ChainOption;
  openseaUrl: string;
  explorerUrl: string;
  source: "opensea" | "address" | "fallback";
}

export interface MintStage {
  id: StageKind;
  label: string;
  source: StageSource;
  status: StageStatus;
  startTime: string | null;
  endTime: string | null;
  priceEth: string;
  maxPerWallet: number | null;
  eligible: "checked" | "unknown" | "watch-only" | "ended" | "unavailable";
  summary: string;
  feeRecipient?: string;
  calldataPreview?: string;
  warnings: string[];
}

export interface MintDiscoveryResponse {
  ok: true;
  query: string;
  resolvedAt: string;
  collection: CollectionCard;
  stages: MintStage[];
  warnings: string[];
}

export interface MintDiscoveryError {
  ok: false;
  error: string;
  warnings?: string[];
}

export interface StageQuantity {
  stageId: StageKind;
  quantity: number;
}

export type ScheduleStageInput = Omit<MintStage, "calldataPreview">;

export interface ScheduleRequest {
  collection: CollectionCard;
  stages: ScheduleStageInput[];
  quantities: StageQuantity[];
  walletCount: number;
  wallets?: ScheduleWallet[];
  maxFeeGwei: number;
  gasLimit: number;
  drainAddress?: string;
  finalProduct: FinalProductControls;
}

export interface ScheduleResponse {
  ok: true;
  scheduleId: string;
  createdAt: string;
  canBroadcast: false;
  fireAt: string | null;
  walletsUsed: number;
  walletSelection: {
    aliases: string[];
    addresses: string[];
    unlockedVaultCount: number;
    executionMode: ExecutionMode;
  };
  selectedStages: {
    stageId: StageKind;
    label: string;
    quantity: number;
    fireAt: string | null;
    source: StageSource;
  }[];
  totals: {
    mintEth: string;
    gasCeilingEth: string;
    grandTotalEth: string;
  };
  drainAddress?: string;
  finalProduct: FinalProductControls & {
    walletAliasCount: number;
    localCliCommand: string;
  };
  warnings: string[];
}

export interface ScheduleError {
  ok: false;
  error: string;
}
