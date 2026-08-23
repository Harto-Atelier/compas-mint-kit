import { Interface, JsonRpcProvider, Wallet, parseEther } from "ethers";

export type BrowserBroadcastChainKey = "ethereum" | "base" | "robinhood";
export type BrowserMintStatus = "prepared" | "simulated" | "broadcast" | "failed";
export type BrowserMintStageSource = "onchain-seadrop" | "opensea-signed-preview" | "mock-preview";

export interface UnlockedLaunchVaultWallet {
  alias: string;
  address: string;
  chain: string;
  privateKey: string;
}

export interface UnlockedLaunchVault {
  status: "unlocked";
  unlockedAt: string;
  wallets: UnlockedLaunchVaultWallet[];
}

export interface BrowserMintStageInput {
  id: string;
  label: string;
  source: BrowserMintStageSource;
  quantity: number;
  priceEth: string;
  feeRecipient?: string | null;
}

export interface BrowserMintPlanInput {
  chainKey: string;
  collectionAddress: string;
  stages: BrowserMintStageInput[];
  walletCount: number;
  vault: UnlockedLaunchVault | null | undefined;
  rpcUrl?: string;
  seaDropAddress?: string;
}

export interface BrowserChainConfig {
  key: BrowserBroadcastChainKey;
  name: string;
  chainId: number;
  explorer: string;
  nativeSymbol: "ETH";
  rpcUrl: string | null;
  seaDropAddress: string | null;
  ready: boolean;
  warnings: string[];
}

export interface BrowserPreparedMintRequest {
  to: string;
  data: string;
  value: bigint;
}

export interface BrowserPreparedMint {
  id: string;
  chain: BrowserChainConfig;
  rpcUrl: string;
  walletAlias: string;
  walletAddress: string;
  stageId: string;
  stageLabel: string;
  quantity: number;
  request: BrowserPreparedMintRequest;
  status: BrowserMintStatus;
  simulationGas?: string;
  hash?: string;
  explorerUrl?: string;
  error?: string;
}

export interface BrowserMintPlan {
  chain: BrowserChainConfig;
  rpcUrl: string;
  transactions: BrowserPreparedMint[];
  warnings: string[];
}

export interface BrowserRunReportTransaction {
  id: string;
  walletAlias: string;
  walletAddress: string;
  stageId: string;
  stageLabel: string;
  quantity: number;
  status: BrowserMintStatus;
  valueWei: string;
  gasEstimate?: string;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}

export interface BrowserRunReport {
  schemaVersion: "browser-run-report.v1";
  generatedAt: string;
  source: "browser";
  collection: { address: string; name: string };
  chain: Pick<BrowserChainConfig, "key" | "name" | "chainId" | "explorer">;
  gasStrategy?: BrowserGasStrategyPlan;
  summary: Record<BrowserMintStatus | "total", number>;
  transactions: BrowserRunReportTransaction[];
}

export interface BrowserGasStrategyInput {
  maxFeeGwei: number;
  priorityFeeGwei: number;
  retryLimit: number;
  escalationPercent: number;
  nonceMode: "sequential" | "parallel";
}

export interface BrowserGasStrategyPlan extends BrowserGasStrategyInput {
  attempts: { attempt: number; maxFeeGwei: string; priorityFeeGwei: string }[];
  warnings: string[];
}

export interface BrowserRpcProviderLike {
  call(request: BrowserPreparedMintRequest & { from: string }): Promise<string>;
  estimateGas(request: BrowserPreparedMintRequest & { from: string }): Promise<bigint>;
}

export interface BrowserWalletLike {
  sendTransaction(request: BrowserPreparedMintRequest): Promise<{ hash: string }>;
}

const OPENSEA_SEADROP_ADDRESS = "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TX_PRIVATE_KEYS = new WeakMap<BrowserPreparedMint, string>();
const IFACE = new Interface([
  "function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable",
]);

const CHAIN_ALIASES: Record<string, BrowserBroadcastChainKey> = {
  eth: "ethereum",
  ethereum: "ethereum",
  mainnet: "ethereum",
  base: "base",
  robinhood: "robinhood",
};

const BROWSER_CHAINS: Record<BrowserBroadcastChainKey, Omit<BrowserChainConfig, "rpcUrl" | "seaDropAddress" | "ready" | "warnings"> & { defaultRpcUrl: string | null; defaultSeaDropAddress: string | null }> = {
  ethereum: {
    key: "ethereum",
    chainId: 1,
    name: "Ethereum",
    explorer: "https://etherscan.io",
    nativeSymbol: "ETH",
    defaultRpcUrl: "https://ethereum-rpc.publicnode.com",
    defaultSeaDropAddress: OPENSEA_SEADROP_ADDRESS,
  },
  base: {
    key: "base",
    chainId: 8453,
    name: "Base",
    explorer: "https://basescan.org",
    nativeSymbol: "ETH",
    defaultRpcUrl: "https://mainnet.base.org",
    defaultSeaDropAddress: OPENSEA_SEADROP_ADDRESS,
  },
  robinhood: {
    key: "robinhood",
    chainId: 4663,
    name: "Robinhood Chain",
    explorer: "https://robinhoodchain.blockscout.com",
    nativeSymbol: "ETH",
    defaultRpcUrl: null,
    defaultSeaDropAddress: null,
  },
};

export function normalizeBrowserChainKey(chainKey: string): BrowserBroadcastChainKey {
  const normalized = chainKey.trim().toLowerCase();
  return CHAIN_ALIASES[normalized] ?? "base";
}

export function browserChainConfig(input: { chainKey: string; rpcUrl?: string; seaDropAddress?: string }): BrowserChainConfig {
  const key = normalizeBrowserChainKey(input.chainKey);
  const base = BROWSER_CHAINS[key];
  const customRpc = clean(input.rpcUrl);
  const customSeaDrop = clean(input.seaDropAddress);
  const rpcUrl = customRpc ?? base.defaultRpcUrl;
  const seaDropAddress = customSeaDrop ?? base.defaultSeaDropAddress;
  const warnings: string[] = [];

  if (!rpcUrl) warnings.push(`${base.name} requires an operator RPC URL before browser dry-run or broadcast.`);
  if (!seaDropAddress) warnings.push(`${base.name} requires a verified SeaDrop singleton address before executable calldata is prepared.`);
  if (key === "robinhood" && !customRpc) warnings.push("Robinhood browser execution is disabled until the operator supplies a Robinhood RPC URL.");
  if (key === "robinhood" && !customSeaDrop) warnings.push("Robinhood browser execution is disabled until the operator supplies a verified SeaDrop address.");

  return {
    key,
    chainId: base.chainId,
    name: base.name,
    explorer: base.explorer,
    nativeSymbol: base.nativeSymbol,
    rpcUrl,
    seaDropAddress,
    ready: warnings.length === 0,
    warnings,
  };
}

export function buildBrowserMintPlan(input: BrowserMintPlanInput): BrowserMintPlan {
  if (!input.vault || input.vault.status !== "unlocked" || input.vault.wallets.length === 0) {
    throw new Error("Unlock the encrypted launch vault before preparing browser-side signing transactions.");
  }

  const chain = browserChainConfig(input);
  if (!chain.ready || !chain.rpcUrl || !chain.seaDropAddress) {
    throw new Error(chain.warnings.join(" ") || "Selected chain is not ready for browser execution.");
  }

  const executableStages = input.stages.filter((stage) => stage.source === "onchain-seadrop" && stage.quantity > 0 && stage.feeRecipient);
  if (executableStages.length === 0) {
    throw new Error("No executable SeaDrop public stage is selected. Signed/mock stages remain preview-only.");
  }

  const wallets = input.vault.wallets.slice(0, Math.max(1, Math.floor(input.walletCount)));
  const transactions: BrowserPreparedMint[] = [];

  for (const [walletIndex, wallet] of wallets.entries()) {
    for (const stage of executableStages) {
      const request: BrowserPreparedMintRequest = {
        to: chain.seaDropAddress,
        data: IFACE.encodeFunctionData("mintPublic", [input.collectionAddress, stage.feeRecipient, ZERO_ADDRESS, BigInt(stage.quantity)]),
        value: parseEther(stage.priceEth || "0") * BigInt(stage.quantity),
      };
      const prepared: BrowserPreparedMint = makeSerializablePreparedMint({
        id: `${wallet.alias || `wallet-${walletIndex + 1}`}-${stage.id}-${walletIndex}`,
        chain,
        rpcUrl: chain.rpcUrl,
        walletAlias: wallet.alias || `wallet-${walletIndex + 1}`,
        walletAddress: wallet.address,
        stageId: stage.id,
        stageLabel: stage.label,
        quantity: stage.quantity,
        request,
        status: "prepared",
      });
      TX_PRIVATE_KEYS.set(prepared, wallet.privateKey);
      transactions.push(prepared);
    }
  }

  return {
    chain,
    rpcUrl: chain.rpcUrl,
    transactions,
    warnings: chain.warnings,
  };
}

export async function simulatePreparedBrowserMint(tx: BrowserPreparedMint, provider?: BrowserRpcProviderLike): Promise<BrowserPreparedMint> {
  const rpc = provider ?? (new JsonRpcProvider(tx.rpcUrl) as unknown as BrowserRpcProviderLike);
  try {
    await rpc.call({ ...tx.request, from: tx.walletAddress });
    const gas = await rpc.estimateGas({ ...tx.request, from: tx.walletAddress });
    return copyWithPrivateKey(tx, { status: "simulated", simulationGas: gas.toString(), error: undefined });
  } catch (error) {
    return copyWithPrivateKey(tx, { status: "failed", error: safeMessageOf(error) });
  }
}

export async function broadcastPreparedBrowserMint(
  tx: BrowserPreparedMint,
  deps: {
    explicitConsent: boolean;
    makeWallet?: (privateKey: string, provider: unknown) => BrowserWalletLike;
    provider?: unknown;
  },
): Promise<BrowserPreparedMint> {
  if (tx.status !== "simulated") throw new Error("Dry-run/simulate before broadcast.");
  if (!deps.explicitConsent) throw new Error("Explicit broadcast confirmation is required before signing and sending.");

  const privateKey = TX_PRIVATE_KEYS.get(tx);
  if (!privateKey) throw new Error("Unlocked private key is no longer available in memory. Re-unlock the vault.");

  const provider = deps.provider ?? new JsonRpcProvider(tx.rpcUrl);
  const wallet = deps.makeWallet ? deps.makeWallet(privateKey, provider) : (new Wallet(privateKey, provider as JsonRpcProvider) as unknown as BrowserWalletLike);
  try {
    const response = await wallet.sendTransaction(tx.request);
    return copyWithPrivateKey(tx, {
      status: "broadcast",
      hash: response.hash,
      explorerUrl: explorerTxUrl(tx.chain.key, response.hash),
      error: undefined,
    });
  } catch (error) {
    return copyWithPrivateKey(tx, { status: "failed", error: safeMessageOf(error) });
  }
}

export function buildBrowserRunReport(input: {
  collection: { address: string; name?: string | null };
  chain: BrowserChainConfig;
  transactions: BrowserPreparedMint[];
  gasStrategy?: BrowserGasStrategyPlan;
  generatedAt?: string;
}): BrowserRunReport {
  const summary: BrowserRunReport["summary"] = { total: input.transactions.length, prepared: 0, simulated: 0, broadcast: 0, failed: 0 };
  const transactions = input.transactions.map((tx) => {
    summary[tx.status] += 1;
    return {
      id: tx.id,
      walletAlias: tx.walletAlias,
      walletAddress: tx.walletAddress,
      stageId: tx.stageId,
      stageLabel: tx.stageLabel,
      quantity: tx.quantity,
      status: tx.status,
      valueWei: tx.request.value.toString(),
      gasEstimate: tx.simulationGas,
      txHash: tx.hash,
      explorerUrl: tx.explorerUrl,
      error: tx.error ? safeMessageOf(tx.error) : undefined,
    };
  });

  return {
    schemaVersion: "browser-run-report.v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source: "browser",
    collection: { address: input.collection.address, name: input.collection.name || "Browser mint run" },
    chain: { key: input.chain.key, name: input.chain.name, chainId: input.chain.chainId, explorer: input.chain.explorer },
    gasStrategy: input.gasStrategy,
    summary,
    transactions,
  };
}

export function buildBrowserGasStrategy(input: BrowserGasStrategyInput): BrowserGasStrategyPlan {
  const retryLimit = clampInteger(input.retryLimit, 0, 5);
  const escalationPercent = clampNumber(input.escalationPercent, 0, 50);
  const maxFeeGwei = clampNumber(input.maxFeeGwei, 0.001, 1_000);
  const priorityFeeGwei = clampNumber(input.priorityFeeGwei, 0.001, maxFeeGwei);
  const attempts = Array.from({ length: retryLimit + 1 }, (_, index) => {
    const multiplier = 1 + (escalationPercent / 100) * index;
    return {
      attempt: index + 1,
      maxFeeGwei: formatGwei(maxFeeGwei * multiplier),
      priorityFeeGwei: formatGwei(Math.min(priorityFeeGwei * multiplier, maxFeeGwei * multiplier)),
    };
  });
  const warnings: string[] = [];
  if (input.nonceMode === "parallel") warnings.push("Parallel nonce mode can collide under RPC lag; use sequential for funded canaries.");
  if (retryLimit > 3) warnings.push("More than 3 retries can overpay in volatile gas; confirm max spend before broadcast.");
  if (priorityFeeGwei > maxFeeGwei * 0.8) warnings.push("Priority fee is close to max fee; leave base-fee headroom.");

  return { ...input, maxFeeGwei, priorityFeeGwei, retryLimit, escalationPercent, attempts, warnings };
}

export function explorerTxUrl(chainKey: string, hash: string): string {
  const chain = BROWSER_CHAINS[normalizeBrowserChainKey(chainKey)];
  return `${chain.explorer}/tx/${hash}`;
}

function copyWithPrivateKey(tx: BrowserPreparedMint, patch: Partial<BrowserPreparedMint>): BrowserPreparedMint {
  const next = makeSerializablePreparedMint({ ...tx, ...patch });
  const privateKey = TX_PRIVATE_KEYS.get(tx);
  if (privateKey) TX_PRIVATE_KEYS.set(next, privateKey);
  return next;
}

function makeSerializablePreparedMint(tx: BrowserPreparedMint): BrowserPreparedMint {
  return Object.defineProperty(tx, "toJSON", {
    enumerable: false,
    value() {
      return {
        ...tx,
        request: {
          ...tx.request,
          value: tx.request.value.toString(),
        },
      };
    },
  });
}

function clean(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function safeMessageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/[^\s"'`)]+/g, "[redacted-url]")
    .replace(/\b(?:0x)?[a-fA-F0-9]{64}\b/g, "[redacted-hex]");
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clampNumber(value, min, max));
}

function formatGwei(value: number): string {
  return value.toFixed(value >= 1 ? 2 : 4).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
