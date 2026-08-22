import chalk from "chalk";
import { formatEther, getAddress, isAddress, JsonRpcProvider, parseEther, Wallet } from "ethers";
import { ChainProfile, resolveChain } from "./chains";
import { buildLocalMintPlan, LocalMintPlan } from "./seadrop-public";
import { maskRpc, planRpcs, resolveRpcsForChain, toRpcUrl } from "./rpc-resolver";
import { parseRpcEndpoints } from "./rpc-blast";

export type WalletSourceKind = "private-key-env" | "address-env";
export type MultiWalletMode = "dry-run" | "broadcast-requested";

export interface WalletSource {
  alias: string;
  envVar: string;
}

export interface ResolvedWallet {
  alias: string;
  envVar: string;
  address: string;
  sourceKind: WalletSourceKind;
}

export interface CliPlanOptions {
  walletDescriptors: string[];
  chainKey: string;
  chainExplicit: boolean;
  contract?: string;
  quantity: number;
  rpcInputs: string[];
  rpcEnvVars: string[];
  maxFeeGwei: number;
  priorityFeeGwei: number;
  gasLimit: number;
  concurrency?: number;
  maxSpendWei?: bigint;
  maxSpendEthText?: string;
  broadcastConfirmation?: string;
  json: boolean;
  mode: MultiWalletMode;
  broadcastRequested: boolean;
  help: boolean;
}

export interface BroadcastSafetyGateInput {
  chainKey: string;
  chainExplicit: boolean;
  maxSpendWei?: bigint;
  maxSpendEthText?: string;
  confirmation?: string;
}

export interface BroadcastSafetyReadiness {
  broadcastPermitted: true;
  spendCapWei: bigint;
  confirmationPhrase: string;
  requiredReReadBeforeSigning: true;
  privateKeyMaterialLogged: false;
}

export interface DryRunBatchEntry {
  alias: string;
  address: string;
  envVar: string;
}

export interface DryRunWalletPlan extends DryRunBatchEntry {
  sourceKind: WalletSourceKind;
  txIndex: number;
  quantity: number;
  calldataBytes: number;
  estimatedGas: number;
  mintValueWei: bigint;
  maxGasReservationWei: bigint;
  maxUpfrontWei: bigint;
  balanceWei?: bigint | null;
  enoughBalance?: boolean | null;
}

export interface DryRunPlan {
  mode: MultiWalletMode;
  broadcastEnabled: boolean;
  chain: {
    name: string;
    chainId: number;
    nativeSymbol: string;
  };
  nftContract: string;
  seadrop: string;
  feeRecipient: string;
  quantity: number;
  calldata: {
    bytes: number;
    identicalForEveryWallet: boolean;
  };
  gas: {
    gasLimit: number;
    maxFeePerGasWei: bigint;
    maxPriorityFeePerGasWei: bigint;
    maxGasReservationWei: bigint;
  };
  perWallet: DryRunWalletPlan[];
  concurrency: {
    width: number;
    batches: DryRunBatchEntry[][];
  };
  totals: {
    wallets: number;
    transactions: number;
    totalQuantity: number;
    mintValueWei: bigint;
    maxGasReservationWei: bigint;
    maxUpfrontWei: bigint;
  };
}

export interface BuildDryRunPlanInput {
  chainName: string;
  chainId: number;
  nativeSymbol: string;
  nftContract: string;
  quantity: number;
  wallets: ResolvedWallet[];
  mintPlan: LocalMintPlan;
  gasLimit: number;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  concurrency: number;
  mode: MultiWalletMode;
  balancesWei?: Record<string, bigint | null>;
}

const RAW_PRIVATE_KEY_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;
const ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ALIAS_RE = /^[A-Za-z0-9_.-]+$/;

export function parseWalletSources(descriptors: string[]): WalletSource[] {
  if (descriptors.length === 0) {
    throw new Error("Add at least one --wallet alias=ENV_VAR entry.");
  }

  const seenAliases = new Set<string>();
  const seenEnvVars = new Set<string>();
  return descriptors.flatMap((descriptor) =>
    descriptor
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        if (RAW_PRIVATE_KEY_RE.test(part)) {
          throw new Error("Pass wallet aliases or env var names, not raw private keys.");
        }

        const splitAt = firstSeparator(part);
        const alias = (splitAt === -1 ? part : part.slice(0, splitAt)).trim();
        const envVar = (splitAt === -1 ? part : part.slice(splitAt + 1)).trim();

        if (!ALIAS_RE.test(alias)) {
          throw new Error(`Invalid wallet alias "${alias}". Use letters, numbers, dot, dash or underscore.`);
        }
        if (!ENV_VAR_RE.test(envVar)) {
          throw new Error(`Invalid env var name "${envVar}" for wallet "${alias}".`);
        }
        if (seenAliases.has(alias)) {
          throw new Error(`Duplicate wallet alias "${alias}".`);
        }
        if (seenEnvVars.has(envVar)) {
          throw new Error(`Duplicate wallet env var "${envVar}".`);
        }
        seenAliases.add(alias);
        seenEnvVars.add(envVar);
        return { alias, envVar };
      })
  );
}

export function resolveWalletsFromEnv(
  sources: WalletSource[],
  env: NodeJS.ProcessEnv = process.env
): ResolvedWallet[] {
  return sources.map((source) => {
    const raw = (env[source.envVar] || "").trim();
    if (!raw) {
      throw new Error(`Wallet env var ${source.envVar} for alias "${source.alias}" is not set.`);
    }

    if (RAW_PRIVATE_KEY_RE.test(raw)) {
      const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
      return {
        ...source,
        address: new Wallet(normalized).address,
        sourceKind: "private-key-env",
      };
    }

    if (isLooseAddress(raw)) {
      return {
        ...source,
        address: getAddress(raw.toLowerCase()),
        sourceKind: "address-env",
      };
    }

    throw new Error(
      `Wallet env var ${source.envVar} must contain a public 0x address for planning or a private key for a future explicit broadcast path.`
    );
  });
}

export function buildDryRunPlan(input: BuildDryRunPlanInput): DryRunPlan {
  const calldataBytes = byteLength(input.mintPlan.data);
  const maxGasReservationWei = BigInt(input.gasLimit) * input.maxFeePerGas;
  const concurrency = normalizeConcurrency(input.concurrency, input.wallets.length);

  const perWallet: DryRunWalletPlan[] = input.wallets.map((wallet, txIndex) => {
    const balanceWei = input.balancesWei?.[wallet.address.toLowerCase()];
    const maxUpfrontWei = maxGasReservationWei + input.mintPlan.value;
    return {
      alias: wallet.alias,
      envVar: wallet.envVar,
      address: wallet.address,
      sourceKind: wallet.sourceKind,
      txIndex,
      quantity: input.quantity,
      calldataBytes,
      estimatedGas: input.gasLimit,
      mintValueWei: input.mintPlan.value,
      maxGasReservationWei,
      maxUpfrontWei,
      ...(balanceWei !== undefined
        ? { balanceWei, enoughBalance: balanceWei === null ? null : balanceWei >= maxUpfrontWei }
        : {}),
    };
  });

  const batches: DryRunBatchEntry[][] = [];
  for (let i = 0; i < perWallet.length; i += concurrency) {
    batches.push(
      perWallet.slice(i, i + concurrency).map(({ alias, address, envVar }) => ({ alias, address, envVar }))
    );
  }

  return {
    mode: input.mode,
    broadcastEnabled: false,
    chain: {
      name: input.chainName,
      chainId: input.chainId,
      nativeSymbol: input.nativeSymbol,
    },
    nftContract: input.nftContract,
    seadrop: input.mintPlan.to,
    feeRecipient: input.mintPlan.feeRecipient,
    quantity: input.quantity,
    calldata: {
      bytes: calldataBytes,
      identicalForEveryWallet: true,
    },
    gas: {
      gasLimit: input.gasLimit,
      maxFeePerGasWei: input.maxFeePerGas,
      maxPriorityFeePerGasWei: input.maxPriorityFeePerGas,
      maxGasReservationWei,
    },
    perWallet,
    concurrency: {
      width: concurrency,
      batches,
    },
    totals: {
      wallets: perWallet.length,
      transactions: perWallet.length,
      totalQuantity: input.quantity * perWallet.length,
      mintValueWei: input.mintPlan.value * BigInt(perWallet.length),
      maxGasReservationWei: maxGasReservationWei * BigInt(perWallet.length),
      maxUpfrontWei: perWallet.reduce((total, wallet) => total + wallet.maxUpfrontWei, 0n),
    },
  };
}

export function expectedBroadcastConfirmation(
  chainKey: string,
  nftContract: string,
  maxSpendEthText: string,
  nativeSymbol: string
): string {
  return `BROADCAST ${chainKey.trim().toUpperCase()} ${normalizeAddress(nftContract)} MAX ${maxSpendEthText.trim()} ${nativeSymbol}`;
}

export function buildBroadcastSafetyReadiness(
  plan: DryRunPlan,
  gate: BroadcastSafetyGateInput
): BroadcastSafetyReadiness {
  if (!gate.chainExplicit) {
    throw new Error("--chain is required with --broadcast; CHAIN env/defaults are ignored for broadcast safety.");
  }
  if (gate.maxSpendWei === undefined || !gate.maxSpendEthText) {
    throw new Error("--max-spend-eth is required with --broadcast and must cap the total max upfront spend.");
  }
  if (gate.maxSpendWei <= 0n) {
    throw new Error("--max-spend-eth must be greater than zero.");
  }
  if (plan.totals.maxUpfrontWei > gate.maxSpendWei) {
    throw new Error(
      `Planned max upfront ${formatEther(plan.totals.maxUpfrontWei)} ${plan.chain.nativeSymbol} exceeds --max-spend-eth cap ${formatEther(gate.maxSpendWei)} ${plan.chain.nativeSymbol}.`
    );
  }
  const addressOnlyWallets = plan.perWallet.filter((wallet) => wallet.sourceKind !== "private-key-env");
  if (addressOnlyWallets.length > 0) {
    throw new Error(
      `--broadcast requires private-key env wallets; address-only wallet(s): ${addressOnlyWallets.map((wallet) => wallet.alias).join(", ")}.`
    );
  }

  const expected = expectedBroadcastConfirmation(gate.chainKey, plan.nftContract, gate.maxSpendEthText, plan.chain.nativeSymbol);
  if ((gate.confirmation || "").trim() !== expected) {
    throw new Error(`--broadcast requires typed confirmation: --confirm-broadcast "${expected}"`);
  }

  return {
    broadcastPermitted: true,
    spendCapWei: gate.maxSpendWei,
    confirmationPhrase: expected,
    requiredReReadBeforeSigning: true,
    privateKeyMaterialLogged: false,
  };
}

export function assertFreshMintPlanUnchanged(original: LocalMintPlan, refreshed: LocalMintPlan): void {
  const changed: string[] = [];
  if (original.to.toLowerCase() !== refreshed.to.toLowerCase()) changed.push("to");
  if (original.data !== refreshed.data) changed.push("data");
  if (original.value !== refreshed.value) changed.push("value");
  if (original.feeRecipient.toLowerCase() !== refreshed.feeRecipient.toLowerCase()) changed.push("feeRecipient");

  const dropFields: (keyof LocalMintPlan["drop"])[] = [
    "mintPrice",
    "startTime",
    "endTime",
    "maxTotalMintableByWallet",
    "feeBps",
    "restrictFeeRecipients",
  ];
  for (const field of dropFields) {
    if (original.drop[field] !== refreshed.drop[field]) changed.push(`drop.${field}`);
  }

  if (changed.length > 0) {
    throw new Error(`On-chain contract/stage changed before signing: ${changed.join(", ")}. Re-run the dry-run plan.`);
  }
}

export function parseCliPlanArgs(args: string[]): CliPlanOptions {
  const opts: CliPlanOptions = {
    walletDescriptors: [],
    chainKey: (process.env.CHAIN || "base").trim().toLowerCase(),
    chainExplicit: false,
    quantity: 1,
    rpcInputs: [],
    rpcEnvVars: [],
    maxFeeGwei: numberFromEnv("MAX_FEE_PER_GAS", 2),
    priorityFeeGwei: numberFromEnv("MAX_PRIORITY_FEE", 0.05),
    gasLimit: numberFromEnv("GAS_LIMIT", 250_000),
    concurrency: undefined,
    json: false,
    mode: "dry-run",
    broadcastRequested: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    if (arg === "--json") {
      opts.json = true;
      continue;
    }
    if (arg === "--dry-run") {
      opts.mode = "dry-run";
      opts.broadcastRequested = false;
      continue;
    }
    if (arg === "--broadcast") {
      opts.mode = "broadcast-requested";
      opts.broadcastRequested = true;
      continue;
    }

    const [name, inlineValue] = splitOption(arg);
    const takesValue = (option: string): string => {
      if (inlineValue !== undefined) return inlineValue;
      const value = args[++i];
      if (!value || value.startsWith("--")) {
        throw new Error(`${option} requires a value.`);
      }
      return value;
    };

    switch (name) {
      case "--wallet":
      case "--wallet-env":
        opts.walletDescriptors.push(takesValue(name));
        break;
      case "--wallets":
        opts.walletDescriptors.push(...takesValue(name).split(",").map((s) => s.trim()).filter(Boolean));
        break;
      case "--chain":
        opts.chainKey = takesValue(name).toLowerCase();
        opts.chainExplicit = true;
        break;
      case "--contract":
      case "--nft":
        opts.contract = normalizeAddress(takesValue(name));
        break;
      case "--quantity":
        opts.quantity = positiveInteger(takesValue(name), "quantity");
        break;
      case "--rpc":
        opts.rpcInputs.push(takesValue(name));
        break;
      case "--rpc-env":
        opts.rpcEnvVars.push(takesValue(name));
        break;
      case "--max-fee-gwei":
        opts.maxFeeGwei = positiveNumber(takesValue(name), "max fee");
        break;
      case "--max-spend-eth": {
        const text = positiveDecimalText(takesValue(name), "max spend");
        opts.maxSpendEthText = text;
        opts.maxSpendWei = parseEther(text);
        break;
      }
      case "--confirm-broadcast":
        opts.broadcastConfirmation = takesValue(name).trim();
        break;
      case "--priority-fee-gwei":
      case "--tip-gwei":
        opts.priorityFeeGwei = positiveNumber(takesValue(name), "priority fee", true);
        break;
      case "--gas-limit":
        opts.gasLimit = positiveInteger(takesValue(name), "gas limit");
        break;
      case "--concurrency":
        opts.concurrency = positiveInteger(takesValue(name), "concurrency");
        break;
      default:
        throw new Error(`Unknown plan option ${arg}`);
    }
  }

  return opts;
}

export async function runMultiWalletPlanner(args: string[]): Promise<void> {
  const opts = parseCliPlanArgs(args);
  if (opts.help) {
    console.log(PLAN_HELP);
    return;
  }
  if (!opts.contract) {
    throw new Error("--contract 0x... is required for multi-wallet planning.");
  }

  const chain = resolveChain(opts.chainKey);
  if (!chain) {
    throw new Error(`Unknown chain "${opts.chainKey}".`);
  }

  const walletSources = parseWalletSources(opts.walletDescriptors);
  const wallets = resolveWalletsFromEnv(walletSources);

  const manualRpcs = resolveManualRpcs(opts, chain);
  const rpcResolution = resolveRpcsForChain(chain.key, manualRpcs);
  const checked = await planRpcs(rpcResolution.urls, chain.chainId);
  if (checked.urls.length === 0) {
    throw new Error(`No usable RPC endpoint for ${chain.name}.`);
  }
  if (!chain.seadropAddress) {
    throw new Error(
      `${chain.name} has no verified SeaDrop address configured. ` +
        `Set SEADROP_ADDRESS_${chain.key.toUpperCase()} or CHAIN_REGISTRY_JSON before building executable calldata.`
    );
  }

  const mintPlan = await buildLocalMintPlan(checked.urls[0], opts.contract, opts.quantity, chain.seadropAddress);
  if (!mintPlan) {
    throw new Error(`No SeaDrop public drop readable for ${opts.contract} on ${chain.name}.`);
  }

  const provider = new JsonRpcProvider(checked.urls[0]);
  const balances = await fetchBalances(provider, wallets);
  const plan = buildDryRunPlan({
    chainName: chain.name,
    chainId: chain.chainId,
    nativeSymbol: chain.nativeSymbol,
    nftContract: opts.contract,
    quantity: opts.quantity,
    wallets,
    mintPlan,
    gasLimit: opts.gasLimit,
    maxFeePerGas: gweiToWei(opts.maxFeeGwei),
    maxPriorityFeePerGas: gweiToWei(opts.priorityFeeGwei),
    concurrency: opts.concurrency ?? wallets.length,
    mode: opts.mode,
    balancesWei: balances,
  });

  if (opts.broadcastRequested) {
    const readiness = buildBroadcastSafetyReadiness(plan, {
      chainKey: chain.key,
      chainExplicit: opts.chainExplicit,
      maxSpendWei: opts.maxSpendWei,
      maxSpendEthText: opts.maxSpendEthText,
      confirmation: opts.broadcastConfirmation,
    });
    const refreshedMintPlan = await buildLocalMintPlan(checked.urls[0], opts.contract, opts.quantity, chain.seadropAddress);
    if (!refreshedMintPlan) {
      throw new Error("On-chain contract/stage re-read failed before signing; no signing or broadcast attempted.");
    }
    assertFreshMintPlanUnchanged(mintPlan, refreshedMintPlan);

    if (opts.json) {
      console.log(JSON.stringify({ plan, broadcastSafety: readiness, execution: "disabled-no-sign-no-broadcast" }, bigintJsonReplacer, 2));
    } else {
      printDryRunPlan(plan, checked.urls, rpcResolution.source);
      printBroadcastReadiness(readiness);
    }
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(plan, bigintJsonReplacer, 2));
  } else {
    printDryRunPlan(plan, checked.urls, rpcResolution.source);
  }
}

export const PLAN_HELP = `
Multi-wallet SeaDrop planner (dry-run by default)

Usage
  npm start -- plan --contract 0xNFT --wallet hot=HOT_WALLET_KEY [--wallet cold=COLD_WALLET_ADDRESS]

Options
  --wallet alias=ENV_VAR      Wallet alias mapped to an env var. Repeatable.
                              The env var may hold a public address for planning
                              or a private key for a future explicit broadcast path.
                              Never pass raw private keys as CLI arguments.
  --chain base                ethereum | base | robinhood (required with --broadcast)
  --contract 0x...            NFT contract with a SeaDrop public stage (required)
  --quantity 1                NFTs per wallet
  --rpc URL_OR_KEY            Manual RPC URL/API key. Repeatable.
  --rpc-env RPC_URL_BASE      Read RPC URL(s) from an env var. Repeatable.
  --max-fee-gwei 2            EIP-1559 ceiling used for reservation estimate
  --priority-fee-gwei 0.05    EIP-1559 tip estimate
  --gas-limit 250000          Per-wallet gas limit estimate
  --concurrency N             Planned concurrent sends per batch (default: all wallets)
  --max-spend-eth 0.25        Required with --broadcast; hard cap on max upfront spend
  --confirm-broadcast TEXT    Required with --broadcast; exact typed confirmation
  --json                      Print machine-readable plan
  --broadcast                 Mainnet broadcast architecture mode; validates hard
                              gates and re-reads the stage, but this build still
                              stops before signing/broadcasting.

Safety
  Dry-run/no-broadcast is the default. Broadcast architecture requires explicit
  --chain, --max-spend-eth, private-key env wallets, and this exact typed phrase:
  BROADCAST <CHAIN> <CONTRACT> MAX <CAP> <SYMBOL>
  Raw private keys in CLI arguments are rejected and private keys are never logged.
`;

function printDryRunPlan(plan: DryRunPlan, rpcUrls: string[], rpcSource: string): void {
  console.log(chalk.bold.magenta("\n── MULTI-WALLET MINT PLAN (DRY RUN — NO BROADCAST) ──"));
  console.log(chalk.gray("  Wallets are referenced by alias/env var only; raw CLI keys are rejected."));
  console.log(chalk.gray(`  Chain:         ${plan.chain.name} (${plan.chain.chainId})`));
  console.log(chalk.gray(`  Contract:      ${plan.nftContract}`));
  console.log(chalk.gray(`  SeaDrop:       ${plan.seadrop}`));
  console.log(chalk.gray(`  Fee recipient: ${plan.feeRecipient}`));
  console.log(chalk.gray(`  RPC:           ${maskRpc(rpcUrls[0])} (${rpcSource}) + ${Math.max(0, rpcUrls.length - 1)} more`));
  console.log(chalk.gray(`  Calldata:      ${plan.calldata.bytes} bytes, identical for every wallet`));
  console.log(chalk.gray(`  Gas:           limit ${plan.gas.gasLimit} · max ${formatGwei(plan.gas.maxFeePerGasWei)} gwei · tip ${formatGwei(plan.gas.maxPriorityFeePerGasWei)} gwei`));
  console.log(chalk.gray(`  Quantity:      ${plan.quantity} per wallet → ${plan.totals.totalQuantity} total`));
  console.log(chalk.bold.white("\nWallet plan"));

  for (const wallet of plan.perWallet) {
    const balance = wallet.balanceWei === undefined || wallet.balanceWei === null
      ? "balance unavailable"
      : `${formatEther(wallet.balanceWei)} ${plan.chain.nativeSymbol}`;
    const enough = wallet.enoughBalance === false ? chalk.red(" ✗ under max reservation") : "";
    console.log(
      `  [${wallet.txIndex}] ${wallet.alias} (${wallet.envVar}) ${wallet.address} · max upfront ${formatEther(wallet.maxUpfrontWei)} ${plan.chain.nativeSymbol} · ${balance}${enough}`
    );
  }

  console.log(chalk.bold.white("\nConcurrency"));
  console.log(chalk.gray(`  Width: ${plan.concurrency.width}; ${plan.concurrency.batches.length} batch(es)`));
  plan.concurrency.batches.forEach((batch, index) => {
    console.log(chalk.gray(`  Batch ${index + 1}: ${batch.map((entry) => entry.alias).join(", ")}`));
  });

  console.log(chalk.bold.yellow("\nDRY RUN ONLY: nothing was signed or broadcast."));
  console.log(chalk.gray("Use --broadcast only with explicit chain, spend cap, typed confirmation, and operator control."));
}

function printBroadcastReadiness(readiness: BroadcastSafetyReadiness): void {
  console.log(chalk.bold.red("\n── BROADCAST SAFETY GATES PASSED (ARCHITECTURE ONLY) ──"));
  console.log(chalk.gray(`  Spend cap:     ${formatEther(readiness.spendCapWei)}`));
  console.log(chalk.gray(`  Confirmed:     ${readiness.confirmationPhrase}`));
  console.log(chalk.gray("  Stage re-read: unchanged immediately before the future signing boundary"));
  console.log(chalk.bold.yellow("  NO SIGNING OR BROADCAST IS IMPLEMENTED IN THIS CLI PATH."));
}

function firstSeparator(value: string): number {
  const eq = value.indexOf("=");
  const colon = value.indexOf(":");
  if (eq === -1) return colon;
  if (colon === -1) return eq;
  return Math.min(eq, colon);
}

function splitOption(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  if (index === -1) return [arg, undefined];
  return [arg.slice(0, index), arg.slice(index + 1)];
}

function isLooseAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value) || isAddress(value);
}

function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (!isLooseAddress(trimmed)) {
    throw new Error(`Invalid contract address "${value}".`);
  }
  return getAddress(trimmed.toLowerCase());
}

function byteLength(hexData: string): number {
  return hexData.startsWith("0x") ? (hexData.length - 2) / 2 : hexData.length / 2;
}

function normalizeConcurrency(value: number, walletCount: number): number {
  if (!Number.isFinite(value) || value < 1) return Math.max(1, walletCount);
  return Math.max(1, Math.min(Math.floor(value), Math.max(1, walletCount)));
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value: string, label: string, allowZero = false): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new Error(`${label} must be ${allowZero ? "zero or " : ""}greater than zero.`);
  }
  return parsed;
}

function positiveDecimalText(value: string, label: string): string {
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text)) {
    throw new Error(`${label} must be a positive ETH decimal with up to 18 decimals.`);
  }
  if (parseEther(text) <= 0n) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return text;
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function gweiToWei(gwei: number): bigint {
  return BigInt(Math.round(gwei * 1e9));
}

function formatGwei(wei: bigint): string {
  return (Number(wei) / 1e9).toString();
}

function resolveManualRpcs(opts: CliPlanOptions, chain: ChainProfile): string[] {
  const rawValues = [
    ...opts.rpcInputs,
    ...opts.rpcEnvVars.flatMap((envVar) => (process.env[envVar] || "").split(",")),
  ];

  return rawValues
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = toRpcUrl(value, chain.key);
      if (!url) throw new Error(`RPC value for ${chain.name} is not a URL or supported provider key format.`);
      return url;
    });
}

async function fetchBalances(
  provider: JsonRpcProvider,
  wallets: ResolvedWallet[]
): Promise<Record<string, bigint | null>> {
  const entries = await Promise.all(
    wallets.map(async (wallet) => {
      try {
        return [wallet.address.toLowerCase(), await provider.getBalance(wallet.address)] as const;
      } catch {
        return [wallet.address.toLowerCase(), null] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

function bigintJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function labelOf(url: string): string {
  return parseRpcEndpoints([url])[0].label;
}

void labelOf;
