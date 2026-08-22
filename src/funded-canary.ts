import chalk from "chalk";
import { formatEther, getAddress, isAddress, JsonRpcProvider, Wallet } from "ethers";
import { ChainProfile, resolveChain } from "./chains";
import { localPublicSnipe } from "./local-mint";
import { parseRpcEndpoints } from "./rpc-blast";
import { maskRpc, planRpcs, resolveRpcsForChain, toRpcUrl } from "./rpc-resolver";
import { buildLocalMintPlan, LocalMintPlan } from "./seadrop-public";
import {
  parseWalletSources,
  resolveWalletsFromEnv,
  ResolvedWallet,
  WalletSource,
} from "./multi-wallet-planner";

export const CANARY_BROADCAST_CONFIRMATION = "I_APPROVE_FUNDED_CANARY";

export interface CanaryCliOptions {
  walletDescriptor?: string;
  chainKey: string;
  contract?: string;
  quantity: number;
  rpcInputs: string[];
  rpcEnvVars: string[];
  maxFeeGwei: number;
  priorityFeeGwei: number;
  gasLimit: number;
  maxTotalEth?: number;
  broadcastConfirm?: string;
  json: boolean;
  help: boolean;
}

export interface CanaryReport {
  mode: "dry-run" | "broadcast-confirmed";
  broadcastEnabled: boolean;
  chain: {
    key: string;
    name: string;
    chainId: number;
    nativeSymbol: string;
  };
  wallet: {
    alias: string;
    envVar: string;
    address: string;
    sourceKind: ResolvedWallet["sourceKind"];
    balanceWei: bigint;
  };
  nftContract: string;
  seadrop: string;
  feeRecipient: string;
  quantity: number;
  stage: {
    status: "live" | "upcoming" | "ended";
    startTime: string;
    endTime: string;
    maxTotalMintableByWallet: number;
    mintPriceWei: bigint;
  };
  rpc: {
    primary: string;
    source: string;
    totalUsable: number;
    droppedWrongChain: number;
    sendOnly: number;
  };
  gas: {
    gasLimit: number;
    maxFeePerGasWei: bigint;
    maxPriorityFeePerGasWei: bigint;
    currentBaseFeeGwei: number | null;
    maxGasReservationWei: bigint;
  };
  cost: {
    mintValueWei: bigint;
    maxUpfrontWei: bigint;
    capWei: bigint;
    capHeadroomWei: bigint;
  };
  warnings: string[];
}

export function parseCliCanaryArgs(args: string[]): CanaryCliOptions {
  const opts: CanaryCliOptions = {
    chainKey: (process.env.CHAIN || "base").trim().toLowerCase(),
    quantity: 1,
    rpcInputs: [],
    rpcEnvVars: [],
    maxFeeGwei: numberFromEnv("MAX_FEE_PER_GAS", 2),
    priorityFeeGwei: numberFromEnv("MAX_PRIORITY_FEE", 0.05),
    gasLimit: numberFromEnv("GAS_LIMIT", 250_000),
    json: false,
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
        if (opts.walletDescriptor) throw new Error("Canary mode accepts exactly one --wallet entry.");
        opts.walletDescriptor = takesValue(name);
        break;
      case "--chain":
        opts.chainKey = takesValue(name).toLowerCase();
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
      case "--priority-fee-gwei":
      case "--tip-gwei":
        opts.priorityFeeGwei = positiveNumber(takesValue(name), "priority fee", true);
        break;
      case "--gas-limit":
        opts.gasLimit = positiveInteger(takesValue(name), "gas limit");
        break;
      case "--max-total-eth":
      case "--max-cost-eth":
      case "--cost-cap-eth":
        opts.maxTotalEth = positiveNumber(takesValue(name), "max total ETH cap");
        break;
      case "--broadcast-confirm":
        opts.broadcastConfirm = takesValue(name);
        break;
      default:
        throw new Error(`Unknown canary option ${arg}`);
    }
  }

  if (opts.priorityFeeGwei > opts.maxFeeGwei) {
    throw new Error("priority fee cannot exceed max fee.");
  }

  return opts;
}

export async function runFundedCanary(args: string[]): Promise<void> {
  const opts = parseCliCanaryArgs(args);
  if (opts.help) {
    console.log(CANARY_HELP);
    return;
  }

  const reportContext = await buildCanaryReportFromOptions(opts);
  if (opts.json) {
    console.log(JSON.stringify(reportContext.report, bigintJsonReplacer, 2));
  } else {
    printCanaryReport(reportContext.report);
  }

  if (!reportContext.broadcastEnabled) {
    console.log(chalk.bold.yellow("\nSTOPPED BEFORE BROADCAST — dry-run/no-broadcast is the default."));
    console.log(chalk.gray(`To broadcast this exact funded canary, re-run with --broadcast-confirm ${CANARY_BROADCAST_CONFIRMATION}.`));
    return;
  }

  console.log(chalk.bold.red("\nBROADCAST CONFIRMED: sending exactly one canary transaction."));
  await localPublicSnipe({
    nftContract: reportContext.report.nftContract,
    quantity: reportContext.report.quantity,
    walletKeys: [reportContext.privateKey],
    rpcUrls: reportContext.rpcUrls,
    maxFeePerGas: reportContext.report.gas.maxFeePerGasWei,
    maxPriorityFee: reportContext.report.gas.maxPriorityFeePerGasWei,
    gasLimit: reportContext.report.gas.gasLimit,
    targetStart: reportContext.targetStart,
    plan: reportContext.mintPlan,
  });
}

export interface CanaryReportContext {
  report: CanaryReport;
  rpcUrls: string[];
  mintPlan: LocalMintPlan;
  targetStart: Date | null;
  broadcastEnabled: boolean;
  privateKey: string;
}

export async function buildCanaryReportFromOptions(opts: CanaryCliOptions): Promise<CanaryReportContext> {
  if (!opts.walletDescriptor) throw new Error("--wallet alias=ENV_VAR is required for canary mode.");
  if (!opts.contract) throw new Error("--contract 0x... is required for canary mode.");
  if (opts.maxTotalEth === undefined) throw new Error("--max-total-eth is required for funded canary mode.");

  const chain = resolveChain(opts.chainKey);
  if (!chain) throw new Error(`Unknown chain "${opts.chainKey}".`);

  const sources = parseWalletSources([opts.walletDescriptor]);
  requireExactlyOneWallet(sources);
  const [wallet] = resolveWalletsFromEnv(sources);

  const manualRpcs = resolveManualRpcs(opts, chain);
  const rpcResolution = resolveRpcsForChain(chain.key, manualRpcs);
  const checked = await planRpcs(rpcResolution.urls, chain.chainId);
  if (checked.urls.length === 0) throw new Error(`No usable RPC endpoint for ${chain.name}.`);
  if (!checked.verified) throw new Error(`Could not verify any RPC endpoint is ${chain.name} (${chain.chainId}).`);

  const mintPlan = await buildLocalMintPlan(checked.urls[0], opts.contract, opts.quantity);
  if (!mintPlan) throw new Error(`No SeaDrop public drop readable for ${opts.contract} on ${chain.name}.`);

  const provider = new JsonRpcProvider(checked.urls[0]);
  const [balanceWei, baseFeeGwei] = await Promise.all([
    provider.getBalance(wallet.address).catch(() => null),
    currentBaseFeeGwei(provider),
  ]);
  if (balanceWei === null) throw new Error(`Could not read balance for canary wallet ${wallet.address}.`);

  const maxFeePerGas = gweiToWei(opts.maxFeeGwei);
  const maxPriorityFeePerGas = gweiToWei(opts.priorityFeeGwei);
  if (baseFeeGwei !== null && opts.maxFeeGwei < baseFeeGwei) {
    throw new Error(`max fee ${opts.maxFeeGwei} gwei is below current base fee ${baseFeeGwei.toFixed(6)} gwei.`);
  }

  const maxGasReservationWei = BigInt(opts.gasLimit) * maxFeePerGas;
  const maxUpfrontWei = maxGasReservationWei + mintPlan.value;
  const capWei = parseEthCap(opts.maxTotalEth);
  if (maxUpfrontWei > capWei) {
    throw new Error(
      `Canary max upfront ${formatEther(maxUpfrontWei)} ${chain.nativeSymbol} exceeds cap ${formatEther(capWei)} ${chain.nativeSymbol}.`
    );
  }
  if (balanceWei < maxUpfrontWei) {
    throw new Error(
      `Canary wallet ${wallet.address} has ${formatEther(balanceWei)} ${chain.nativeSymbol}, needs ${formatEther(maxUpfrontWei)} ${chain.nativeSymbol}.`
    );
  }

  const now = Date.now();
  const startsAtMs = mintPlan.drop.startTime * 1000;
  const endsAtMs = mintPlan.drop.endTime * 1000;
  const status = now < startsAtMs ? "upcoming" : now >= endsAtMs ? "ended" : "live";
  if (status === "ended") throw new Error("SeaDrop public stage has already ended; canary would revert.");
  if (mintPlan.drop.maxTotalMintableByWallet > 0 && opts.quantity > mintPlan.drop.maxTotalMintableByWallet) {
    throw new Error(`quantity ${opts.quantity} exceeds public-stage max ${mintPlan.drop.maxTotalMintableByWallet} per wallet.`);
  }

  const broadcastEnabled = opts.broadcastConfirm === CANARY_BROADCAST_CONFIRMATION;
  if (opts.broadcastConfirm && !broadcastEnabled) {
    throw new Error(`--broadcast-confirm must equal ${CANARY_BROADCAST_CONFIRMATION}.`);
  }
  const privateKey = privateKeyFromEnv(sources[0].envVar);
  if (broadcastEnabled && !privateKey) {
    throw new Error("--broadcast-confirm requires the wallet env var to contain a private key, not only a public address.");
  }

  const warnings: string[] = [];
  if (wallet.sourceKind === "private-key-env" && !broadcastEnabled) {
    warnings.push("Private key env var was read only to derive the wallet address; no transaction was signed or broadcast.");
  }
  if (rpcResolution.source.startsWith("public endpoints")) {
    warnings.push("Using public RPC endpoints only; use a private RPC for a real funded canary.");
  }
  if (status === "upcoming") {
    warnings.push("Stage is upcoming; broadcast-confirmed mode will wait until the on-chain start time.");
  }

  const report: CanaryReport = {
    mode: broadcastEnabled ? "broadcast-confirmed" : "dry-run",
    broadcastEnabled,
    chain: {
      key: chain.key,
      name: chain.name,
      chainId: chain.chainId,
      nativeSymbol: chain.nativeSymbol,
    },
    wallet: {
      alias: wallet.alias,
      envVar: wallet.envVar,
      address: wallet.address,
      sourceKind: wallet.sourceKind,
      balanceWei,
    },
    nftContract: opts.contract,
    seadrop: mintPlan.to,
    feeRecipient: mintPlan.feeRecipient,
    quantity: opts.quantity,
    stage: {
      status,
      startTime: new Date(startsAtMs).toISOString(),
      endTime: new Date(endsAtMs).toISOString(),
      maxTotalMintableByWallet: mintPlan.drop.maxTotalMintableByWallet,
      mintPriceWei: mintPlan.drop.mintPrice,
    },
    rpc: {
      primary: checked.urls[0],
      source: rpcResolution.source,
      totalUsable: checked.urls.length,
      droppedWrongChain: checked.dropped.length,
      sendOnly: checked.sendOnly.length,
    },
    gas: {
      gasLimit: opts.gasLimit,
      maxFeePerGasWei: maxFeePerGas,
      maxPriorityFeePerGasWei: maxPriorityFeePerGas,
      currentBaseFeeGwei: baseFeeGwei,
      maxGasReservationWei,
    },
    cost: {
      mintValueWei: mintPlan.value,
      maxUpfrontWei,
      capWei,
      capHeadroomWei: capWei - maxUpfrontWei,
    },
    warnings,
  };

  return {
    report,
    rpcUrls: checked.urls,
    mintPlan,
    targetStart: status === "upcoming" ? new Date(startsAtMs) : null,
    broadcastEnabled,
    privateKey: privateKey || "",
  };
}

export const CANARY_HELP = `
Funded canary mode (one-wallet guarded run)

Usage
  npm start -- canary --chain base --contract 0xNFT --wallet hot=HOT_WALLET_KEY --quantity 1 --max-total-eth 0.06

Required
  --wallet alias=ENV_VAR      Exactly one wallet env var. Public address is OK for dry-run;
                              private key is required only with --broadcast-confirm.
  --chain base                ethereum | base | robinhood (default: CHAIN env or base)
  --contract 0x...            NFT contract with a SeaDrop public stage
  --quantity 1                Exactly one per-wallet quantity for the canary
  --max-total-eth 0.06        Hard cap for mint value + gasLimit × maxFee

Optional
  --rpc URL_OR_KEY            Manual RPC URL/API key. Repeatable.
  --rpc-env RPC_URL_BASE      Read RPC URL(s) from an env var. Repeatable.
  --max-fee-gwei 2            EIP-1559 ceiling used for reservation and signing
  --priority-fee-gwei 0.05    EIP-1559 tip
  --gas-limit 250000          Per-wallet gas limit
  --json                      Print machine-readable validation report
  --broadcast-confirm ${CANARY_BROADCAST_CONFIRMATION}
                              Explicit final approval. Without this exact phrase,
                              canary mode stops before signing/broadcasting.

Safety
  Canary mode validates wallet env, selected chain, RPC chain ID, SeaDrop public
  stage, balance, per-wallet limit, gas ceiling and max-total cap. By default it
  signs nothing and broadcasts nothing.
`;

function requireExactlyOneWallet(sources: WalletSource[]): void {
  if (sources.length !== 1) {
    throw new Error("Canary mode requires exactly one wallet descriptor.");
  }
}

function splitOption(arg: string): [string, string | undefined] {
  const index = arg.indexOf("=");
  if (index === -1) return [arg, undefined];
  return [arg.slice(0, index), arg.slice(index + 1)];
}

function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (!(/^0x[0-9a-fA-F]{40}$/.test(trimmed) || isAddress(trimmed))) {
    throw new Error(`Invalid contract address "${value}".`);
  }
  return getAddress(trimmed.toLowerCase());
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

function parseEthCap(value: number): bigint {
  return BigInt(Math.round(value * 1e9)) * 1_000_000_000n;
}

function resolveManualRpcs(opts: CanaryCliOptions, chain: ChainProfile): string[] {
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

async function currentBaseFeeGwei(provider: JsonRpcProvider): Promise<number | null> {
  try {
    const fee = await provider.getFeeData();
    const wei = fee.gasPrice ?? fee.maxFeePerGas;
    return wei === null || wei === undefined ? null : Number(wei) / 1e9;
  } catch {
    return null;
  }
}

function privateKeyFromEnv(envVar: string): string | null {
  const raw = (process.env[envVar] || "").trim();
  if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(raw)) return null;
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  try {
    // Validate without retaining any derived object.
    void new Wallet(normalized).address;
    return normalized;
  } catch {
    return null;
  }
}

function printCanaryReport(report: CanaryReport): void {
  console.log(chalk.bold.magenta("\n── FUNDED CANARY VALIDATION ──"));
  console.log(chalk.gray(`  Mode:          ${report.broadcastEnabled ? "broadcast-confirmed" : "dry-run / no-broadcast"}`));
  console.log(chalk.gray(`  Chain:         ${report.chain.name} (${report.chain.chainId})`));
  console.log(chalk.gray(`  Contract:      ${report.nftContract}`));
  console.log(chalk.gray(`  SeaDrop:       ${report.seadrop}`));
  console.log(chalk.gray(`  Wallet:        ${report.wallet.alias} (${report.wallet.envVar}) ${report.wallet.address}`));
  console.log(chalk.gray(`  Balance:       ${formatEther(report.wallet.balanceWei)} ${report.chain.nativeSymbol}`));
  console.log(chalk.gray(`  RPC:           ${maskRpc(report.rpc.primary)} (${report.rpc.source}) + ${Math.max(0, report.rpc.totalUsable - 1)} more`));
  console.log(chalk.gray(`  Stage:         ${report.stage.status} · ${report.stage.startTime} → ${report.stage.endTime}`));
  console.log(chalk.gray(`  Quantity:      ${report.quantity}`));
  console.log(chalk.gray(`  Price:         ${formatEther(report.stage.mintPriceWei)} × ${report.quantity} = ${formatEther(report.cost.mintValueWei)} ${report.chain.nativeSymbol}`));
  console.log(chalk.gray(`  Gas:           limit ${report.gas.gasLimit} · max ${formatGwei(report.gas.maxFeePerGasWei)} gwei · tip ${formatGwei(report.gas.maxPriorityFeePerGasWei)} gwei`));
  if (report.gas.currentBaseFeeGwei !== null) {
    console.log(chalk.gray(`  Base fee now:  ${report.gas.currentBaseFeeGwei.toFixed(6)} gwei`));
  }
  console.log(chalk.gray(`  Max upfront:   ${formatEther(report.cost.maxUpfrontWei)} ${report.chain.nativeSymbol}`));
  console.log(chalk.gray(`  Cost cap:      ${formatEther(report.cost.capWei)} ${report.chain.nativeSymbol} (${formatEther(report.cost.capHeadroomWei)} headroom)`));

  if (report.warnings.length > 0) {
    console.log(chalk.bold.yellow("\nWarnings"));
    for (const warning of report.warnings) console.log(chalk.yellow(`  ⚠ ${warning}`));
  }

  console.log(chalk.bold.green("\n✓ Canary checks passed: env, RPC, chain, stage, balance and max-cost cap."));
}

function bigintJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function labelOf(url: string): string {
  return parseRpcEndpoints([url])[0].label;
}

void labelOf;
