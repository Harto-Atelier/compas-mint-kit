import { Interface, JsonRpcProvider, Wallet, formatEther, id, keccak256, parseEther } from "ethers";

import { isAlreadyKnownBroadcastError } from "./guided-fast-path";

export type BrowserBroadcastChainKey = "ethereum" | "base" | "robinhood";
export type BrowserMintStatus = "prepared" | "simulated" | "broadcast" | "failed";
export type BrowserMintStageSource = "onchain-seadrop" | "opensea-signed-preview" | "mock-preview";
export type BrowserMintRecipientMode = "payer" | "holder" | "custom";

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
  recipientMode?: BrowserMintRecipientMode;
  holderRecipientAddress?: string | null;
  customRecipientAddress?: string | null;
  maxTotalEth?: number;
  maxTotalValueWei?: bigint;
  gasLimit?: bigint;
  maxFeePerGasWei?: bigint;
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
  nonce?: number;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

export interface BrowserLowLatencyPrepareInput {
  nonce: number;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface BrowserSignedMint {
  transaction: BrowserPreparedMint;
  binding: string;
  lowLatencyBinding: string;
  expectedHash: string;
  rawSignedTransaction: BrowserRawSignedTransaction;
  signedAt: string;
}

export class BrowserRawSignedTransaction {
  #raw: string;
  #lowLatencyBinding: string;

  constructor(raw: string, lowLatencyBinding: string) {
    if (!/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error("Raw signed transaction must be hex.");
    this.#raw = raw;
    this.#lowLatencyBinding = lowLatencyBinding;
  }

  revealForBroadcast(input: { explicitConsent: boolean; lowLatencyBinding?: string }): string {
    if (!input.explicitConsent) throw new Error("Explicit raw transaction broadcast consent is required.");
    if (input.lowLatencyBinding !== this.#lowLatencyBinding) {
      throw new Error("Raw signed transaction binding does not match the current low-latency transaction.");
    }
    return this.#raw;
  }

  toJSON(): string {
    return "[redacted-raw-signed-transaction]";
  }

  toString(): string {
    return "[redacted-raw-signed-transaction]";
  }

  valueOf(): string {
    return this.toString();
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}

export interface BrowserPreparedMint {
  id: string;
  binding: string;
  lowLatencyBinding?: string;
  chain: BrowserChainConfig;
  rpcUrl: string;
  walletAlias: string;
  walletAddress: string;
  recipientMode: BrowserMintRecipientMode;
  recipientAddress: string;
  stageId: string;
  stageLabel: string;
  quantity: number;
  request: BrowserPreparedMintRequest;
  status: BrowserMintStatus;
  simulationGas?: string;
  hash?: string;
  explorerUrl?: string;
  error?: string;
  broadcastAttempted?: boolean;
}

export interface BrowserMintPlan {
  binding: string;
  chain: BrowserChainConfig;
  rpcUrl: string;
  totalValueWei: bigint;
  maxTotalWei?: bigint;
  transactions: BrowserPreparedMint[];
  warnings: string[];
}

export interface BrowserRunReportTransaction {
  id: string;
  walletAlias: string;
  walletAddress: string;
  recipientMode: BrowserMintRecipientMode;
  recipientAddress: string;
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

export interface BrowserMintSafetyCheck {
  id: string;
  ok: boolean;
  label: string;
  value: string;
}

export interface BrowserMintCalldataReview {
  functionName: "mintPublic" | "unknown";
  nftContract?: string;
  feeRecipient?: string;
  minterIfNotPayer?: string;
  quantity?: string;
  checks: BrowserMintSafetyCheck[];
  readyForBroadcast: boolean;
}

export interface BrowserRpcProviderLike {
  getNetwork(): Promise<{ chainId: bigint | number }>;
  call(request: BrowserPreparedMintRequest & { from: string }): Promise<string>;
  estimateGas(request: BrowserPreparedMintRequest & { from: string }): Promise<bigint>;
}

export interface BrowserWalletLike {
  sendTransaction(request: BrowserPreparedMintRequest): Promise<{ hash: string }>;
}

export interface BrowserBroadcastTimingEvent {
  txId: string;
  stage: string;
  elapsedMs: number;
  deltaMs: number;
  atMs: number;
}

export type BrowserBroadcastTimingSink = (event: BrowserBroadcastTimingEvent) => void;

export type GuidedMintReceiptStatus = "Submitted" | "Confirming" | "Unknown" | "Confirmed" | "Failed";

export interface GuidedMintReceipt {
  transactionId: string;
  binding: string;
  hash: string;
  status: GuidedMintReceiptStatus;
  confirmations: number;
  verifiedRecipient?: string;
  tokenIds?: string[];
  error?: string;
}

export interface BrowserTransactionReceiptLike {
  status: number | bigint | string;
  blockNumber: number;
  hash?: string;
  transactionHash?: string;
  logs: Array<{ address: string; topics: readonly string[]; data?: string }>;
}

export interface BrowserReceiptProviderLike {
  getNetwork(): Promise<{ chainId: bigint | number }>;
  getTransactionReceipt(hash: string): Promise<BrowserTransactionReceiptLike | null>;
  getBlockNumber(): Promise<number>;
  getBalance(address: string): Promise<bigint>;
}

const OPENSEA_SEADROP_ADDRESS = "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
interface BrowserPreparedMintContext {
  privateKey: string;
  revoked: boolean;
  binding: string;
  target: string;
  feeRecipient: string;
  value: bigint;
  nonce?: number;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  broadcasting?: boolean;
}
const TX_CONTEXT = new WeakMap<BrowserPreparedMint, BrowserPreparedMintContext>();
const IFACE = new Interface([
  "function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable",
]);
const ERC721_TRANSFER_TOPIC = id("Transfer(address,address,uint256)").toLowerCase();
const ZERO_ADDRESS_TOPIC = `0x${"0".repeat(64)}`;

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
  const recipientPlan = resolveRecipientPlan(input);
  const totalValueWei = executableStages.reduce(
    (sum, stage) => sum + parseEther(stage.priceEth || "0") * BigInt(stage.quantity) * BigInt(wallets.length),
    BigInt(0),
  );
  if (input.maxTotalEth !== undefined && input.maxTotalValueWei !== undefined) {
    throw new Error("Use either a decimal ETH cap or an exact wei cap, not both.");
  }
  let maxTotalWei = input.maxTotalValueWei;
  if (maxTotalWei !== undefined && (typeof maxTotalWei !== "bigint" || maxTotalWei < BigInt(0))) {
    throw new Error("Aggregate mint value cap must be a non-negative bigint wei amount.");
  }
  if (input.maxTotalEth !== undefined) {
    if (!Number.isFinite(input.maxTotalEth) || input.maxTotalEth < 0) throw new Error("Aggregate mint value cap must be a non-negative finite ETH amount.");
    maxTotalWei = parseEther(String(input.maxTotalEth));
  }
  if (maxTotalWei !== undefined && totalValueWei > maxTotalWei) {
    throw new Error(`Aggregate mint value ${formatEther(totalValueWei)} ETH exceeds the configured ${formatEther(maxTotalWei)} ETH cap (network gas excluded).`);
  }
  if ((input.gasLimit === undefined) !== (input.maxFeePerGasWei === undefined)) {
    throw new Error("Mint gas limit and maximum fee per gas must be configured together.");
  }
  if (input.gasLimit !== undefined && (typeof input.gasLimit !== "bigint" || input.gasLimit <= BigInt(0))) {
    throw new Error("Mint gas limit must be a positive bigint.");
  }
  if (input.maxFeePerGasWei !== undefined && (typeof input.maxFeePerGasWei !== "bigint" || input.maxFeePerGasWei <= BigInt(0))) {
    throw new Error("Maximum fee per gas must be a positive bigint wei amount.");
  }
  const binding = id(JSON.stringify({
    chainKey: chain.key,
    chainId: chain.chainId,
    rpcUrl: chain.rpcUrl,
    seaDropAddress: chain.seaDropAddress.toLowerCase(),
    collectionAddress: input.collectionAddress.toLowerCase(),
    recipientMode: recipientPlan.mode,
    recipientAddress: recipientPlan.address.toLowerCase(),
    walletCount: wallets.length,
    walletAddresses: wallets.map((wallet) => wallet.address.toLowerCase()),
    maxTotalWei: maxTotalWei?.toString() ?? null,
    gasLimit: input.gasLimit?.toString() ?? null,
    maxFeePerGasWei: input.maxFeePerGasWei?.toString() ?? null,
    stages: executableStages.map((stage) => ({
      id: stage.id,
      quantity: stage.quantity,
      priceEth: stage.priceEth,
      feeRecipient: stage.feeRecipient!.toLowerCase(),
    })),
  }));

  for (const [walletIndex, wallet] of wallets.entries()) {
    for (const stage of executableStages) {
      const recipientAddress = recipientPlan.mode === "payer" ? ZERO_ADDRESS : recipientPlan.address;
      const request: BrowserPreparedMintRequest = {
        to: chain.seaDropAddress,
        data: IFACE.encodeFunctionData("mintPublic", [input.collectionAddress, stage.feeRecipient, recipientAddress, BigInt(stage.quantity)]),
        value: parseEther(stage.priceEth || "0") * BigInt(stage.quantity),
        gasLimit: input.gasLimit,
        maxFeePerGas: input.maxFeePerGasWei,
      };
      const prepared: BrowserPreparedMint = makeSerializablePreparedMint({
        id: `${wallet.alias || `wallet-${walletIndex + 1}`}-${stage.id}-${walletIndex}`,
        binding,
        chain,
        rpcUrl: chain.rpcUrl,
        walletAlias: wallet.alias || `wallet-${walletIndex + 1}`,
        walletAddress: wallet.address,
        recipientMode: recipientPlan.mode,
        recipientAddress: recipientPlan.mode === "payer" ? wallet.address : recipientPlan.address,
        stageId: stage.id,
        stageLabel: stage.label,
        quantity: stage.quantity,
        request,
        status: "prepared",
      });
      TX_CONTEXT.set(prepared, {
        privateKey: wallet.privateKey,
        revoked: false,
        binding,
        target: chain.seaDropAddress,
        feeRecipient: stage.feeRecipient!,
        value: request.value,
        gasLimit: request.gasLimit,
        maxFeePerGas: request.maxFeePerGas,
      });
      transactions.push(prepared);
    }
  }

  const plan: BrowserMintPlan = {
    binding,
    chain,
    rpcUrl: chain.rpcUrl,
    totalValueWei,
    maxTotalWei,
    transactions,
    warnings: chain.warnings,
  };
  return Object.defineProperty(plan, "toJSON", {
    enumerable: false,
    value() {
      return { ...plan, totalValueWei: totalValueWei.toString(), maxTotalWei: maxTotalWei?.toString() };
    },
  });
}

function resolveRecipientPlan(input: BrowserMintPlanInput): { mode: BrowserMintRecipientMode; address: string } {
  const mode = input.recipientMode;
  if (!mode) throw new Error("An explicit recipient mode is required before preparing browser mint transactions.");
  if (mode === "payer") return { mode, address: ZERO_ADDRESS };
  const address = mode === "holder" ? clean(input.holderRecipientAddress) : clean(input.customRecipientAddress);
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(mode === "holder" ? "Connect and verify a Compas holder wallet before routing mints to the holder recipient." : "Enter a valid custom recipient address before preparing recipient-routed mints.");
  }
  return { mode, address };
}

export function reviewPreparedBrowserMintCalldata(tx: BrowserPreparedMint, expected?: { collectionAddress?: string; holderRecipientAddress?: string | null; maxQuantity?: number }): BrowserMintCalldataReview {
  try {
    const storedContext = TX_CONTEXT.get(tx);
    const context = storedContext?.revoked ? undefined : storedContext;
    const decoded = IFACE.decodeFunctionData("mintPublic", tx.request.data);
    const nftContract = String(decoded[0]);
    const feeRecipient = String(decoded[1]);
    const minterIfNotPayer = String(decoded[2]);
    const quantity = decoded[3].toString();
    const recipientTarget = tx.recipientMode === "payer" ? ZERO_ADDRESS : tx.recipientAddress;
    const checks: BrowserMintSafetyCheck[] = [
      { id: "function", label: "Function", ok: true, value: "mintPublic" },
      { id: "plan-binding", label: "Plan binding matches", ok: Boolean(context && tx.binding === context.binding), value: tx.binding },
      { id: "target", label: "SeaDrop target matches", ok: Boolean(context && tx.request.to.toLowerCase() === context.target.toLowerCase()), value: tx.request.to },
      { id: "collection", label: "Collection matches", ok: !expected?.collectionAddress || nftContract.toLowerCase() === expected.collectionAddress.toLowerCase(), value: nftContract },
      { id: "fee-recipient", label: "Fee recipient matches", ok: Boolean(context && feeRecipient.toLowerCase() === context.feeRecipient.toLowerCase()), value: feeRecipient },
      { id: "recipient", label: "Recipient routing matches", ok: minterIfNotPayer.toLowerCase() === recipientTarget.toLowerCase(), value: minterIfNotPayer },
      { id: "holder", label: "Verified holder recipient", ok: tx.recipientMode !== "holder" || Boolean(expected?.holderRecipientAddress && tx.recipientAddress.toLowerCase() === expected.holderRecipientAddress.toLowerCase()), value: tx.recipientAddress },
      { id: "quantity", label: "Quantity within policy", ok: !expected?.maxQuantity || Number(quantity) <= expected.maxQuantity, value: quantity },
      { id: "value", label: "Transaction value matches", ok: Boolean(context && tx.request.value === context.value), value: tx.request.value.toString() },
      { id: "nonce", label: "Nonce matches", ok: Boolean(context && tx.request.nonce === context.nonce), value: tx.request.nonce?.toString() ?? "provider-managed" },
      { id: "gas-limit", label: "Gas limit matches", ok: Boolean(context && tx.request.gasLimit === context.gasLimit), value: tx.request.gasLimit?.toString() ?? "provider-estimated" },
      { id: "max-fee", label: "Maximum fee per gas matches", ok: Boolean(context && tx.request.maxFeePerGas === context.maxFeePerGas), value: tx.request.maxFeePerGas?.toString() ?? "provider-estimated" },
      { id: "priority-fee", label: "Priority fee per gas matches", ok: Boolean(context && tx.request.maxPriorityFeePerGas === context.maxPriorityFeePerGas), value: tx.request.maxPriorityFeePerGas?.toString() ?? "provider-estimated" },
      { id: "status", label: "Simulation passed", ok: tx.status === "simulated", value: tx.status },
    ];
    return { functionName: "mintPublic", nftContract, feeRecipient, minterIfNotPayer, quantity, checks, readyForBroadcast: checks.every((check) => check.ok) };
  } catch {
    const checks = [{ id: "function", label: "Function", ok: false, value: "unrecognized calldata" }];
    return { functionName: "unknown", checks, readyForBroadcast: false };
  }
}

export async function simulatePreparedBrowserMint(tx: BrowserPreparedMint, provider?: BrowserRpcProviderLike): Promise<BrowserPreparedMint> {
  if (isTerminalBrowserMint(tx)) return tx;
  const rpc = provider ?? (new JsonRpcProvider(tx.rpcUrl) as unknown as BrowserRpcProviderLike);
  try {
    const network = await rpc.getNetwork();
    if (BigInt(network.chainId) !== BigInt(tx.chain.chainId)) {
      throw new Error(`RPC chain ID ${network.chainId.toString()} does not match expected ${tx.chain.chainId}.`);
    }
    await rpc.call({ ...tx.request, from: tx.walletAddress });
    const gas = await rpc.estimateGas({ ...tx.request, from: tx.walletAddress });
    return copyWithPrivateKey(tx, { status: "simulated", simulationGas: gas.toString(), error: undefined });
  } catch (error) {
    return copyWithPrivateKey(tx, { status: "failed", error: safeMessageOf(error) });
  }
}

export function prepareLowLatencyBrowserMint(tx: BrowserPreparedMint, input: BrowserLowLatencyPrepareInput): BrowserPreparedMint {
  if (isTerminalBrowserMint(tx)) throw new Error("Terminal browser mint rows cannot be prepared for low-latency signing.");
  validateLowLatencyPrepareInput(input);
  const lowLatencyBinding = id(JSON.stringify({
    planBinding: tx.binding,
    transactionId: tx.id,
    chainId: tx.chain.chainId,
    walletAddress: tx.walletAddress.toLowerCase(),
    to: tx.request.to.toLowerCase(),
    data: tx.request.data,
    value: tx.request.value.toString(),
    nonce: input.nonce,
    gasLimit: input.gasLimit.toString(),
    maxFeePerGas: input.maxFeePerGas.toString(),
    maxPriorityFeePerGas: input.maxPriorityFeePerGas.toString(),
  }));
  const next = makeSerializablePreparedMint({
    ...tx,
    lowLatencyBinding,
    request: {
      ...tx.request,
      nonce: input.nonce,
      gasLimit: input.gasLimit,
      maxFeePerGas: input.maxFeePerGas,
      maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    },
  });
  const context = TX_CONTEXT.get(tx);
  if (context) {
    TX_CONTEXT.set(next, {
      ...context,
      nonce: input.nonce,
      gasLimit: input.gasLimit,
      maxFeePerGas: input.maxFeePerGas,
      maxPriorityFeePerGas: input.maxPriorityFeePerGas,
      broadcasting: false,
    });
  }
  return next;
}

export async function signPreparedBrowserMint(
  tx: BrowserPreparedMint,
  deps: {
    explicitConsent: boolean;
    consentBinding?: string;
    lowLatencyBinding?: string;
    signedAt?: string;
  },
): Promise<BrowserSignedMint> {
  if (tx.status !== "simulated") throw new Error("Dry-run/simulate before low-latency signing.");
  if (!deps.explicitConsent) throw new Error("Explicit signing confirmation is required before creating a raw signed transaction.");
  const context = TX_CONTEXT.get(tx);
  if (!context || context.revoked) throw new Error("Unlocked private key is no longer available in memory. Re-unlock the vault.");
  if (deps.consentBinding !== context.binding || tx.binding !== context.binding) {
    throw new Error("Explicit signing confirmation does not match the current transaction plan. Review and confirm again.");
  }
  if (!tx.lowLatencyBinding || deps.lowLatencyBinding !== tx.lowLatencyBinding) {
    throw new Error("Explicit signing confirmation does not match the prepared low-latency transaction. Review nonce and fee fields again.");
  }
  if (!hasFullLowLatencyRequest(tx.request)) {
    throw new Error("Low-latency signing requires a prepared nonce, gas limit, max fee, and priority fee.");
  }
  if (!reviewPreparedBrowserMintCalldata(tx, {
    holderRecipientAddress: tx.recipientMode === "holder" ? tx.recipientAddress : undefined,
  }).readyForBroadcast) {
    throw new Error("Prepared low-latency transaction request no longer matches the simulated mint. Prepare and simulate again.");
  }

  const privateKey = context.privateKey;
  context.revoked = true;
  TX_CONTEXT.delete(tx);
  const raw = await new Wallet(privateKey).signTransaction({
    chainId: BigInt(tx.chain.chainId),
    type: 2,
    to: tx.request.to,
    data: tx.request.data,
    value: tx.request.value,
    nonce: tx.request.nonce,
    gasLimit: tx.request.gasLimit,
    maxFeePerGas: tx.request.maxFeePerGas,
    maxPriorityFeePerGas: tx.request.maxPriorityFeePerGas,
  });
  const signed = {
    transaction: makeSerializablePreparedMint({ ...tx }),
    binding: tx.binding,
    lowLatencyBinding: tx.lowLatencyBinding,
    expectedHash: keccak256(raw),
    rawSignedTransaction: new BrowserRawSignedTransaction(raw, tx.lowLatencyBinding),
    signedAt: deps.signedAt ?? new Date().toISOString(),
  } satisfies BrowserSignedMint;
  return Object.defineProperty(signed, "toJSON", {
    enumerable: false,
    value() {
      return {
        transaction: signed.transaction,
        binding: signed.binding,
        lowLatencyBinding: signed.lowLatencyBinding,
        expectedHash: signed.expectedHash,
        rawSignedTransaction: "[redacted-raw-signed-transaction]",
        signedAt: signed.signedAt,
      };
    },
  });
}

export async function broadcastPreparedBrowserMint(
  tx: BrowserPreparedMint,
  deps: {
    explicitConsent: boolean;
    consentBinding?: string;
    makeWallet?: (privateKey: string, provider: unknown) => BrowserWalletLike;
    provider?: unknown;
    isAuthorityCurrent?: () => boolean;
    timing?: BrowserBroadcastTimingSink;
  },
): Promise<BrowserPreparedMint> {
  const trace = createBroadcastTimingTrace(tx.id, deps.timing);
  trace("consent-received");
  if (tx.status !== "simulated") throw new Error("Dry-run/simulate before broadcast.");
  if (!deps.explicitConsent) throw new Error("Explicit broadcast confirmation is required before signing and sending.");
  trace("consent-validated");

  const context = TX_CONTEXT.get(tx);
  if (!context || context.revoked) throw new Error("Unlocked private key is no longer available in memory. Re-unlock the vault.");
  if (context.broadcasting) throw new Error("This exact mint row is already being broadcast. No duplicate send was started.");
  if (deps.consentBinding !== context.binding || tx.binding !== context.binding) {
    throw new Error("Explicit confirmation does not match the current transaction plan. Review and confirm again.");
  }
  trace("signer-context-validated");
  if (!reviewPreparedBrowserMintCalldata(tx, {
    holderRecipientAddress: tx.recipientMode === "holder" ? tx.recipientAddress : undefined,
  }).readyForBroadcast) {
    throw new Error("Prepared transaction request no longer matches the simulated mint. Prepare and simulate again.");
  }
  trace("calldata-binding-reviewed");

  context.broadcasting = true;
  const provider = deps.provider ?? new JsonRpcProvider(tx.rpcUrl);
  trace("provider-ready");
  try {
    const network = await (provider as { getNetwork(): Promise<{ chainId: bigint | number }> }).getNetwork();
    trace("rpc-chain-check-complete");
    if (BigInt(network.chainId) !== BigInt(tx.chain.chainId)) {
      throw new Error(`RPC chain ID ${network.chainId.toString()} does not match expected ${tx.chain.chainId}.`);
    }
    if (context.revoked || TX_CONTEXT.get(tx) !== context || deps.isAuthorityCurrent?.() === false) {
      throw new Error("Unlocked private key authority changed before broadcast. Re-unlock, prepare, and simulate again.");
    }
    trace("authority-current-before-signing");

    // Consume signer authority synchronously before invoking any wallet/provider code. A
    // second click or concurrent call can never reach sendTransaction for this row.
    const privateKey = context.privateKey;
    context.revoked = true;
    TX_CONTEXT.delete(tx);
    trace("signer-authority-consumed");
    try {
      const wallet = deps.makeWallet ? deps.makeWallet(privateKey, provider) : (new Wallet(privateKey, provider as JsonRpcProvider) as unknown as BrowserWalletLike);
      trace("wallet-object-created");
      if (deps.isAuthorityCurrent?.() === false) {
        throw new Error("Unlocked private key authority changed before broadcast. No transaction was sent.");
      }
      trace("send-transaction-start");
      const response = await wallet.sendTransaction(tx.request);
      trace("send-transaction-response");
      if (!/^0x[0-9a-fA-F]{64}$/.test(response.hash)) {
        throw new Error("Wallet broadcast did not return a valid transaction hash. Treat this row as failed and recover manually; do not retry automatically.");
      }
      trace("broadcast-hash-validated");
      return makeSerializablePreparedMint({
        ...tx,
        status: "broadcast",
        hash: response.hash,
        explorerUrl: explorerTxUrl(tx.chain.key, response.hash),
        error: undefined,
        broadcastAttempted: true,
      });
    } catch (error) {
      trace("broadcast-failed");
      return makeSerializablePreparedMint({ ...tx, status: "failed", error: safeMessageOf(error), broadcastAttempted: true });
    }
  } catch (error) {
    if (!context.revoked && TX_CONTEXT.get(tx) === context) context.broadcasting = false;
    trace("broadcast-preflight-failed");
    throw error;
  }
}

/**
 * Terminal fast-path result row. The signed transaction was accepted by the
 * fast path with its locally computed expected hash, so the row is marked
 * broadcast without ever re-signing or re-sending; receipt polling verifies
 * inclusion exactly like the direct RPC path.
 */
export function markSignedMintBroadcastViaFastPath(signed: BrowserSignedMint): BrowserPreparedMint {
  if (!/^0x[0-9a-fA-F]{64}$/.test(signed.expectedHash)) {
    throw new Error("A valid locally computed expected hash is required before marking a fast-path row broadcast.");
  }
  return makeSerializablePreparedMint({
    ...signed.transaction,
    status: "broadcast",
    hash: signed.expectedHash,
    explorerUrl: explorerTxUrl(signed.transaction.chain.key, signed.expectedHash),
    error: undefined,
    broadcastAttempted: true,
  });
}

/**
 * Direct RPC fallback for an already-signed row whose fast-path send was not
 * proven accepted. It rebroadcasts the EXACT same signed bytes (same hash), so
 * it can never double-mint, and an "already known" answer counts as accepted.
 * The row always becomes terminal: broadcast on acceptance, failed otherwise.
 */
export async function broadcastSignedMintViaRpc(
  signed: BrowserSignedMint,
  deps?: {
    provider?: { getNetwork(): Promise<{ chainId: bigint | number }>; send(method: string, params: unknown[]): Promise<unknown> };
    timing?: BrowserBroadcastTimingSink;
  },
): Promise<BrowserPreparedMint> {
  const tx = signed.transaction;
  const trace = createBroadcastTimingTrace(tx.id, deps?.timing);
  trace("fallback-direct-start");
  try {
    const provider = deps?.provider ?? new JsonRpcProvider(tx.rpcUrl);
    const network = await provider.getNetwork();
    trace("rpc-chain-check-complete");
    if (BigInt(network.chainId) !== BigInt(tx.chain.chainId)) {
      throw new Error(`RPC chain ID ${network.chainId.toString()} does not match expected ${tx.chain.chainId}.`);
    }
    const raw = signed.rawSignedTransaction.revealForBroadcast({
      explicitConsent: true,
      lowLatencyBinding: signed.lowLatencyBinding,
    });
    trace("send-raw-transaction-start");
    let reportedHash: string;
    try {
      reportedHash = String(await provider.send("eth_sendRawTransaction", [raw]));
    } catch (sendError) {
      if (!isAlreadyKnownBroadcastError(sendError)) throw sendError;
      // The exact same bytes are already in the mempool: definite acceptance.
      reportedHash = signed.expectedHash;
    }
    trace("send-raw-transaction-response");
    if (reportedHash.toLowerCase() !== signed.expectedHash.toLowerCase()) {
      throw new Error("Direct RPC broadcast returned a hash that does not match the locally computed expected hash. Recover manually; do not retry automatically.");
    }
    trace("broadcast-hash-validated");
    return makeSerializablePreparedMint({
      ...tx,
      status: "broadcast",
      hash: signed.expectedHash,
      explorerUrl: explorerTxUrl(tx.chain.key, signed.expectedHash),
      error: undefined,
      broadcastAttempted: true,
    });
  } catch (error) {
    trace("broadcast-failed");
    return makeSerializablePreparedMint({ ...tx, status: "failed", error: safeMessageOf(error), broadcastAttempted: true });
  }
}

export function createSubmittedMintReceipt(tx: BrowserPreparedMint): GuidedMintReceipt {
  if (tx.status !== "broadcast" || !tx.hash || !/^0x[0-9a-fA-F]{64}$/.test(tx.hash)) {
    throw new Error("A valid submitted browser mint hash is required before receipt tracking.");
  }
  return {
    transactionId: tx.id,
    binding: tx.binding,
    hash: tx.hash,
    status: "Submitted",
    confirmations: 0,
  };
}

export async function pollPreparedBrowserMintReceipt(
  tx: BrowserPreparedMint,
  current: GuidedMintReceipt,
  provider?: BrowserReceiptProviderLike,
  minimumConfirmations = 1,
): Promise<GuidedMintReceipt> {
  if (
    tx.status !== "broadcast" ||
    !tx.hash ||
    current.transactionId !== tx.id ||
    current.binding !== tx.binding ||
    current.hash.toLowerCase() !== tx.hash.toLowerCase()
  ) {
    return failedReceipt(current, "Receipt tracker does not match the exact submitted mint plan.");
  }
  if (current.status === "Confirmed" || current.status === "Failed") return current;
  const requiredConfirmations = Math.max(1, Math.floor(minimumConfirmations));
  const rpc = provider ?? (new JsonRpcProvider(tx.rpcUrl) as unknown as BrowserReceiptProviderLike);
  try {
    const network = await rpc.getNetwork();
    if (BigInt(network.chainId) !== BigInt(tx.chain.chainId)) {
      throw new Error(`Receipt RPC chain ID ${network.chainId.toString()} does not match expected ${tx.chain.chainId}.`);
    }
    const receipt = await rpc.getTransactionReceipt(tx.hash);
    if (!receipt) return { ...current, status: "Confirming", confirmations: 0, error: undefined };

    const receiptHash = receipt.hash ?? receipt.transactionHash;
    if (receiptHash && receiptHash.toLowerCase() !== tx.hash.toLowerCase()) {
      return failedReceipt(current, "Receipt hash does not match the submitted mint transaction.");
    }
    const succeeded = receipt.status === 1 || receipt.status === BigInt(1) || receipt.status === "0x1";
    const reverted = receipt.status === 0 || receipt.status === BigInt(0) || receipt.status === "0x0";
    if (reverted) return failedReceipt(current, "Mint transaction receipt reports a reverted or failed transaction.");
    if (!succeeded) return unknownReceipt(current, "Receipt status is not yet a canonical success or revert value. Re-poll without rebroadcasting.");
    if (!Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber < 0) {
      return unknownReceipt(current, "Receipt block number is malformed. Re-poll without rebroadcasting.");
    }

    const latestBlock = await rpc.getBlockNumber();
    if (!Number.isSafeInteger(latestBlock) || latestBlock < 0) {
      return unknownReceipt(current, "Latest block number is malformed. Re-poll without rebroadcasting.");
    }
    const confirmations = Math.max(0, latestBlock - receipt.blockNumber + 1);
    if (confirmations < requiredConfirmations) {
      return { ...current, status: "Confirming", confirmations, error: undefined };
    }

    const review = reviewPreparedBrowserMintCalldata(tx, {
      holderRecipientAddress: tx.recipientMode === "holder" ? tx.recipientAddress : undefined,
    });
    const collectionAddress = review.nftContract;
    if (!collectionAddress || tx.recipientMode !== "holder") {
      return failedReceipt(current, "Confirmed receipt cannot verify the bound holder recipient.", confirmations);
    }
    const recipientTopic = addressLogTopic(tx.recipientAddress);
    const tokenIds = receipt.logs
      .filter((log) => (
        log.address.toLowerCase() === collectionAddress.toLowerCase() &&
        log.topics.length >= 4 &&
        log.topics[0].toLowerCase() === ERC721_TRANSFER_TOPIC &&
        log.topics[1].toLowerCase() === ZERO_ADDRESS_TOPIC &&
        log.topics[2].toLowerCase() === recipientTopic
      ))
      .map((log) => BigInt(log.topics[3]).toString());
    if (tokenIds.length < tx.quantity) {
      return failedReceipt(current, "Receipt succeeded but no verified NFT transfer to the bound holder recipient was found.", confirmations);
    }
    return {
      ...current,
      status: "Confirmed",
      confirmations,
      verifiedRecipient: tx.recipientAddress,
      tokenIds: tokenIds.slice(0, tx.quantity),
      error: undefined,
    };
  } catch (error) {
    return unknownReceipt(current, safeMessageOf(error));
  }
}

export function mergeGuidedMintReceipts(
  current: readonly GuidedMintReceipt[],
  updates: readonly GuidedMintReceipt[],
): GuidedMintReceipt[] {
  const merged = [...current];
  for (const update of updates) {
    const index = merged.findIndex((receipt) => (
      receipt.transactionId === update.transactionId &&
      receipt.binding === update.binding &&
      receipt.hash.toLowerCase() === update.hash.toLowerCase()
    ));
    if (index >= 0) merged[index] = update;
    else merged.push(update);
  }
  return merged;
}

export function markGuidedMintReceiptsForReconciliation(
  receipts: readonly GuidedMintReceipt[],
): GuidedMintReceipt[] {
  return receipts.map((receipt) => receipt.status === "Failed" ? receipt : {
    ...receipt,
    status: "Unknown",
    verifiedRecipient: undefined,
    tokenIds: undefined,
    error: "Vault authority changed. Re-poll this submitted hash for receipt reconciliation; never rebroadcast it automatically.",
  });
}

export function hasPreparedBrowserMintSigner(transaction: BrowserPreparedMint): boolean {
  const context = TX_CONTEXT.get(transaction);
  return Boolean(context && !context.revoked && context.binding === transaction.binding);
}

export function revokePreparedBrowserMintSigners(transactions: readonly BrowserPreparedMint[]): void {
  for (const transaction of transactions) {
    const context = TX_CONTEXT.get(transaction);
    if (context) context.revoked = true;
    TX_CONTEXT.delete(transaction);
  }
}

export function isTerminalBrowserMint(transaction: BrowserPreparedMint): boolean {
  return transaction.status === "broadcast" || transaction.broadcastAttempted === true;
}

export function invalidateBrowserMintTransactions(transactions: readonly BrowserPreparedMint[]): BrowserPreparedMint[] {
  const stale = transactions.filter((transaction) => !isTerminalBrowserMint(transaction));
  revokePreparedBrowserMintSigners(stale);
  return transactions.filter(isTerminalBrowserMint);
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
      recipientMode: tx.recipientMode,
      recipientAddress: tx.recipientAddress,
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
  const context = TX_CONTEXT.get(tx);
  if (context) TX_CONTEXT.set(next, context);
  return next;
}

function createBroadcastTimingTrace(txId: string, sink?: BrowserBroadcastTimingSink): (stage: string) => void {
  const start = monotonicNowMs();
  let previous = start;
  return (stage: string) => {
    if (!sink) return;
    const atMs = monotonicNowMs();
    const elapsedMs = atMs - start;
    const deltaMs = atMs - previous;
    previous = atMs;
    sink({
      txId,
      stage,
      elapsedMs: roundTimingMs(elapsedMs),
      deltaMs: roundTimingMs(deltaMs),
      atMs: roundTimingMs(atMs),
    });
  };
}

function monotonicNowMs(): number {
  const performanceLike = globalThis.performance;
  return performanceLike?.now ? performanceLike.now() : Date.now();
}

function roundTimingMs(value: number): number {
  return Math.round(value * 1000) / 1000;
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
          nonce: tx.request.nonce,
          gasLimit: tx.request.gasLimit?.toString(),
          maxFeePerGas: tx.request.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: tx.request.maxPriorityFeePerGas?.toString(),
        },
      };
    },
  });
}

function validateLowLatencyPrepareInput(input: BrowserLowLatencyPrepareInput): void {
  if (!Number.isSafeInteger(input.nonce) || input.nonce < 0) throw new Error("Low-latency nonce must be a non-negative safe integer.");
  if (typeof input.gasLimit !== "bigint" || input.gasLimit <= BigInt(0)) throw new Error("Low-latency gas limit must be a positive bigint.");
  if (typeof input.maxFeePerGas !== "bigint" || input.maxFeePerGas <= BigInt(0)) throw new Error("Low-latency max fee per gas must be a positive bigint.");
  if (typeof input.maxPriorityFeePerGas !== "bigint" || input.maxPriorityFeePerGas <= BigInt(0)) throw new Error("Low-latency priority fee per gas must be a positive bigint.");
  if (input.maxPriorityFeePerGas > input.maxFeePerGas) throw new Error("Low-latency priority fee cannot exceed the max fee per gas.");
}

function hasFullLowLatencyRequest(request: BrowserPreparedMintRequest): request is BrowserPreparedMintRequest & Required<Pick<BrowserPreparedMintRequest, "nonce" | "gasLimit" | "maxFeePerGas" | "maxPriorityFeePerGas">> {
  return (
    typeof request.nonce === "number" && Number.isSafeInteger(request.nonce) && request.nonce >= 0 &&
    typeof request.gasLimit === "bigint" && request.gasLimit > BigInt(0) &&
    typeof request.maxFeePerGas === "bigint" && request.maxFeePerGas > BigInt(0) &&
    typeof request.maxPriorityFeePerGas === "bigint" && request.maxPriorityFeePerGas > BigInt(0) &&
    request.maxPriorityFeePerGas <= request.maxFeePerGas
  );
}

function clean(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function safeMessageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/[^\s"'`)]+/g, "[redacted-url]")
    .replace(/\b(?:0x)?[a-fA-F0-9]{64,}\b/g, "[redacted-hex]");
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

function failedReceipt(current: GuidedMintReceipt, error: string, confirmations = current.confirmations): GuidedMintReceipt {
  return { ...current, status: "Failed", confirmations, verifiedRecipient: undefined, tokenIds: undefined, error };
}

function unknownReceipt(current: GuidedMintReceipt, error: string): GuidedMintReceipt {
  return { ...current, status: "Unknown", verifiedRecipient: undefined, tokenIds: undefined, error };
}

function addressLogTopic(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}
