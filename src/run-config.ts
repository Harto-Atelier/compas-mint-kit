import fs from "fs";
import path from "path";
import chalk from "chalk";
import { getAddress, isAddress } from "ethers";
import { resolveChain } from "./chains";
import { maskRpc } from "./rpc-resolver";

type JsonRecord = Record<string, unknown>;

type StageKind = "team" | "gtd" | "fcfs" | "public";
type StageSource = "onchain-seadrop" | "opensea-signed-preview" | "mock-preview";
type StageStatus = "ended" | "live" | "upcoming" | "unknown";

const STAGE_KINDS: StageKind[] = ["team", "gtd", "fcfs", "public"];
const STAGE_SOURCES: StageSource[] = ["onchain-seadrop", "opensea-signed-preview", "mock-preview"];
const STAGE_STATUSES: StageStatus[] = ["ended", "live", "upcoming", "unknown"];

const MAX_PREVIEW_WALLETS = 200;
const MAX_FEE_GWEI = 10_000;
const PRIVATE_KEY_LIKE_VALUE_RE = /(?:^|[\s,:'"=])(?:0x)?[a-fA-F0-9]{64}(?=$|[\s,:'"])/;
const RAW_TRANSACTION_LIKE_VALUE_RE = /0x[0-9a-fA-F]{130,}/;

export interface CliArgs {
  help: boolean;
  dryRun: boolean;
  configPath?: string;
}

export interface RunCollection {
  name: string;
  address: string;
  chain: {
    key: string;
    name: string;
    chainId: number;
  };
  openseaUrl?: string;
  explorerUrl?: string;
}

export interface RunStage {
  id: StageKind;
  label: string;
  source: StageSource;
  status: StageStatus;
  startTime: string | null;
  endTime: string | null;
  priceEth: number;
  maxPerWallet: number | null;
  feeRecipient?: string;
  warnings: string[];
}

export interface RunQuantity {
  stageId: StageKind;
  quantity: number;
}

export interface RunConfig {
  schemaVersion: number;
  mode: "preview";
  collection: RunCollection;
  stages: RunStage[];
  quantities: RunQuantity[];
  walletCount: number;
  maxFeeGwei: number;
  maxPriorityFeeGwei?: number;
  gasLimit: number;
  drainAddress?: string;
  rpcUrls: string[];
  notes: string[];
}

export interface SelectedRunStage {
  stage: RunStage;
  quantity: number;
  mintEth: number;
}

export interface RunPreviewPlan {
  configPath: string;
  dryRun: true;
  collection: RunCollection;
  walletCount: number;
  selectedStages: SelectedRunStage[];
  maxFeeGwei: number;
  maxPriorityFeeGwei?: number;
  gasLimit: number;
  drainAddress?: string;
  rpcUrls: string[];
  fireAt: string | null;
  totals: {
    mintEth: number;
    gasCeilingEth: number;
    grandTotalEth: number;
  };
  warnings: string[];
  notes: string[];
}

export function parseCliArgs(args: string[]): CliArgs {
  const parsed: CliArgs = { help: false, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--config") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--config requires a JSON file path.");
      parsed.configPath = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length).trim();
      if (!value) throw new Error("--config requires a JSON file path.");
      parsed.configPath = value;
      continue;
    }

    // Preserve the historical wizard flow: unrelated arguments used to be ignored.
    // In config mode, though, unknown flags are almost always typos and should fail.
    if (parsed.configPath && arg.startsWith("--")) {
      throw new Error(`Unknown option in config mode: ${arg}`);
    }
  }

  return parsed;
}

export async function runConfigPreviewFromFile(configPath: string, opts: { dryRun: boolean }): Promise<void> {
  const absolutePath = path.resolve(process.cwd(), configPath);
  const json = readJsonFile(absolutePath);
  const config = parseRunConfig(json);
  const plan = buildRunPreviewPlan(config, absolutePath);
  printRunPreviewPlan(plan, { explicitDryRun: opts.dryRun });
}

export function parseRunConfig(value: unknown): RunConfig {
  assertNoSecretFields(value);
  const root = expectRecord(value, "config");
  const body = expectRecord((root.runConfig ?? root) as unknown, "config");

  const collection = parseCollection(body.collection);
  const stages = expectArray(body.stages, "stages").map((stage, index) => parseStage(stage, `stages[${index}]`));
  const quantities = expectArray(body.quantities, "quantities").map((quantity, index) =>
    parseQuantity(quantity, `quantities[${index}]`)
  );

  if (stages.length === 0) throw new Error("No mint stages supplied.");
  if (quantities.length === 0) throw new Error("Select at least one stage quantity.");

  const walletCount = clampInteger(body.walletCount, 1, MAX_PREVIEW_WALLETS, "walletCount");
  const maxFeeGwei = boundedNumber(body.maxFeeGwei, 0, MAX_FEE_GWEI, "maxFeeGwei");
  const maxPriorityFeeGwei = body.maxPriorityFeeGwei === undefined
    ? undefined
    : boundedNumber(body.maxPriorityFeeGwei, 0, MAX_FEE_GWEI, "maxPriorityFeeGwei");
  const gasLimit = clampInteger(body.gasLimit, 21_000, 2_000_000, "gasLimit");
  const drainAddress = parseOptionalAddress(body.drainAddress, "drainAddress");
  const rpcUrls = parseOptionalRpcUrls(body.rpcUrls);
  const notes = parseOptionalStringArray(body.notes, "notes");

  const selected = quantities.filter((quantity) => quantity.quantity > 0);
  if (selected.length === 0) throw new Error("Set a quantity above zero for at least one stage.");

  for (const quantity of selected) {
    if (!stages.some((stage) => stage.id === quantity.stageId)) {
      throw new Error(`Quantity references missing stage "${quantity.stageId}".`);
    }
  }

  return {
    schemaVersion: clampInteger(body.schemaVersion ?? body.version ?? 1, 1, 1, "schemaVersion"),
    mode: "preview",
    collection,
    stages,
    quantities,
    walletCount,
    maxFeeGwei,
    maxPriorityFeeGwei,
    gasLimit,
    drainAddress,
    rpcUrls,
    notes,
  };
}

export function buildRunPreviewPlan(config: RunConfig, configPath: string): RunPreviewPlan {
  const warnings = ["Dry-run only: no private keys are loaded, no transaction is signed, and nothing is broadcast."];
  const selectedStages = config.quantities
    .filter((quantity) => quantity.quantity > 0)
    .map((quantity) => {
      const stage = config.stages.find((candidate) => candidate.id === quantity.stageId);
      if (!stage) throw new Error(`Quantity references missing stage "${quantity.stageId}".`);
      if (stage.maxPerWallet !== null && quantity.quantity > stage.maxPerWallet) {
        warnings.push(`${stage.label} quantity ${quantity.quantity} exceeds max ${stage.maxPerWallet} per wallet and may revert.`);
      }
      if (stage.source !== "onchain-seadrop") {
        warnings.push(`${stage.label} is ${stage.source}; it requires wallet-specific signed calldata outside this dry-run.`);
      }
      if (stage.status === "ended") {
        warnings.push(`${stage.label} appears ended; keep it for audit only.`);
      }
      for (const warning of stage.warnings) warnings.push(`${stage.label}: ${warning}`);
      return {
        stage,
        quantity: quantity.quantity,
        mintEth: stage.priceEth * quantity.quantity * config.walletCount,
      };
    });

  const mintEth = selectedStages.reduce((sum, selected) => sum + selected.mintEth, 0);
  const gasCeilingEth = config.gasLimit * config.maxFeeGwei * 1e-9 * config.walletCount * selectedStages.length;
  const fireAt = selectedStages
    .map(({ stage }) => stage.startTime)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;

  return {
    configPath,
    dryRun: true,
    collection: config.collection,
    walletCount: config.walletCount,
    selectedStages,
    maxFeeGwei: config.maxFeeGwei,
    maxPriorityFeeGwei: config.maxPriorityFeeGwei,
    gasLimit: config.gasLimit,
    drainAddress: config.drainAddress,
    rpcUrls: config.rpcUrls,
    fireAt,
    totals: {
      mintEth,
      gasCeilingEth,
      grandTotalEth: mintEth + gasCeilingEth,
    },
    warnings: [...new Set(warnings)],
    notes: config.notes,
  };
}

export function printRunPreviewPlan(plan: RunPreviewPlan, opts: { explicitDryRun: boolean }): void {
  console.log(chalk.bold.magenta("\n── CONFIG PREVIEW EXECUTION PLAN ──"));
  console.log(chalk.gray(`  Config:        ${plan.configPath}`));
  if (!opts.explicitDryRun) {
    console.log(chalk.yellow("  Mode:          dry-run only (--config execution is not enabled yet)"));
  } else {
    console.log(chalk.green("  Mode:          dry-run (no signing, no broadcast)"));
  }

  console.log(chalk.bold.white("\nCollection"));
  line("Name", plan.collection.name);
  line("Chain", `${plan.collection.chain.name} (${plan.collection.chain.chainId})`);
  line("Contract", plan.collection.address);
  if (plan.collection.openseaUrl) line("OpenSea", plan.collection.openseaUrl);
  if (plan.collection.explorerUrl) line("Explorer", plan.collection.explorerUrl);

  console.log(chalk.bold.white("\nExecution inputs"));
  line("Wallets", `${plan.walletCount} placeholder wallet(s); private keys are never read from config`);
  line("Gas", `${plan.maxFeeGwei} gwei max fee${plan.maxPriorityFeeGwei === undefined ? "" : ` / ${plan.maxPriorityFeeGwei} gwei priority`} · limit ${plan.gasLimit}`);
  line("Fire at", plan.fireAt ? new Date(plan.fireAt).toISOString() : "manual / stage unknown");
  if (plan.rpcUrls.length > 0) line("RPCs", plan.rpcUrls.map(maskRpc).join(", "));
  if (plan.drainAddress) line("Drain", plan.drainAddress);

  console.log(chalk.bold.white("\nSelected stages"));
  for (const selected of plan.selectedStages) {
    const { stage } = selected;
    console.log(chalk.gray(`  • ${stage.label} [${stage.id} · ${stage.source} · ${stage.status}]`));
    console.log(chalk.gray(`    Quantity: ${selected.quantity} per wallet → ${selected.quantity * plan.walletCount} total`));
    console.log(chalk.gray(`    Price:    ${formatEth(stage.priceEth)} ETH each → ${formatEth(selected.mintEth)} ETH`));
    console.log(chalk.gray(`    Window:   ${formatWindow(stage.startTime, stage.endTime)}`));
    if (stage.feeRecipient) console.log(chalk.gray(`    Fee:      ${stage.feeRecipient}`));
  }

  console.log(chalk.bold.white("\nTotals"));
  line("Mint total", `${formatEth(plan.totals.mintEth)} ETH`);
  line("Gas ceiling", `${formatEth(plan.totals.gasCeilingEth)} ETH`);
  line("Grand total", `${formatEth(plan.totals.grandTotalEth)} ETH`);

  if (plan.notes.length > 0) {
    console.log(chalk.bold.white("\nNotes"));
    for (const note of plan.notes) console.log(chalk.gray(`  • ${note}`));
  }

  console.log(chalk.bold.yellow("\nWarnings"));
  for (const warning of plan.warnings) console.log(chalk.yellow(`  ⚠ ${warning}`));
  console.log(chalk.bold.magenta("\n── END DRY-RUN PLAN ──\n"));
}

function readJsonFile(filePath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new Error(`Could not read config file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(`Config is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function parseCollection(value: unknown): RunCollection {
  const collection = expectRecord(value, "collection");
  const rawChain = expectRecord(collection.chain, "collection.chain");
  const chainKey = expectString(rawChain.key, "collection.chain.key").toLowerCase();
  const known = resolveChain(chainKey);
  if (!known) throw new Error(`Unknown collection.chain.key "${chainKey}".`);

  const suppliedChainId = rawChain.chainId === undefined ? known.chainId : clampInteger(rawChain.chainId, 1, 999_999_999, "collection.chain.chainId");
  if (suppliedChainId !== known.chainId) {
    throw new Error(`collection.chain.chainId ${suppliedChainId} does not match ${known.name} (${known.chainId}).`);
  }

  const address = parseAddress(collection.address, "collection.address");
  return {
    name: optionalString(collection.name) || optionalString(collection.slug) || "Unnamed collection",
    address,
    chain: {
      key: known.key,
      name: known.name,
      chainId: known.chainId,
    },
    openseaUrl: optionalUrl(collection.openseaUrl, "collection.openseaUrl"),
    explorerUrl: optionalUrl(collection.explorerUrl, "collection.explorerUrl"),
  };
}

function parseStage(value: unknown, label: string): RunStage {
  const stage = expectRecord(value, label);
  const id = oneOf(expectString(stage.id, `${label}.id`), STAGE_KINDS, `${label}.id`);
  const source = oneOf(expectString(stage.source, `${label}.source`), STAGE_SOURCES, `${label}.source`);
  const status = oneOf(optionalString(stage.status) || "unknown", STAGE_STATUSES, `${label}.status`);
  const maxPerWallet = stage.maxPerWallet === null || stage.maxPerWallet === undefined
    ? null
    : clampInteger(stage.maxPerWallet, 1, 100, `${label}.maxPerWallet`);
  const feeRecipient = parseOptionalAddress(stage.feeRecipient, `${label}.feeRecipient`);

  return {
    id,
    label: optionalString(stage.label) || id.toUpperCase(),
    source,
    status,
    startTime: parseOptionalDate(stage.startTime, `${label}.startTime`),
    endTime: parseOptionalDate(stage.endTime, `${label}.endTime`),
    priceEth: boundedNumber(stage.priceEth ?? 0, 0, 10_000, `${label}.priceEth`),
    maxPerWallet,
    feeRecipient,
    warnings: parseOptionalStringArray(stage.warnings, `${label}.warnings`),
  };
}

function parseQuantity(value: unknown, label: string): RunQuantity {
  const quantity = expectRecord(value, label);
  return {
    stageId: oneOf(expectString(quantity.stageId, `${label}.stageId`), STAGE_KINDS, `${label}.stageId`),
    quantity: clampInteger(quantity.quantity, 0, 100, `${label}.quantity`),
  };
}

function assertNoSecretFields(value: unknown, pathLabel = "config"): void {
  if (typeof value === "string") {
    if (PRIVATE_KEY_LIKE_VALUE_RE.test(value)) {
      throw new Error(`Private-key-shaped value at "${pathLabel}" is not allowed in a run config.`);
    }
    if (RAW_TRANSACTION_LIKE_VALUE_RE.test(value)) {
      throw new Error(`Raw-transaction-shaped value at "${pathLabel}" is not allowed in a run config.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretFields(item, `${pathLabel}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value as JsonRecord)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      ["privatekey", "privatekeys", "walletkey", "walletkeys", "mnemonic", "seed", "seedphrase", "secret", "secrets", "password", "apikey", "accesstoken", "bearertoken", "cookie", "cookies", "rpcurl", "rpcurls", "providerurl", "providerurls", "rawtx", "rawtransaction", "signedtx", "signedtransaction", "signature", "signatures"].includes(normalized)
    ) {
      throw new Error(`Secret-like field "${pathLabel}.${key}" is not allowed in a run config.`);
    }
    assertNoSecretFields(child, `${pathLabel}.${key}`);
  }
}

function expectRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as JsonRecord;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  const match = allowed.find((candidate) => candidate === value);
  if (!match) throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  return match;
}

function finiteNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number.`);
  return number;
}

function boundedNumber(value: unknown, min: number, max: number, label: string): number {
  const number = finiteNumber(value, label);
  if (number < min || number > max) throw new Error(`${label} must be a number from ${min} to ${max}.`);
  return number;
}

function clampInteger(value: unknown, min: number, max: number, label: string): number {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

function parseAddress(value: unknown, label: string): string {
  const raw = expectString(value, label);
  if (!isAddress(raw)) throw new Error(`${label} must be a valid 0x address.`);
  return getAddress(raw);
}

function parseOptionalAddress(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return parseAddress(value, label);
}

function parseOptionalDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = expectString(value, label);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be an ISO date string or null.`);
  return date.toISOString();
}

function optionalUrl(value: unknown, label: string): string | undefined {
  const raw = optionalString(value);
  if (!raw) return undefined;
  try {
    return new URL(raw).toString();
  } catch {
    throw new Error(`${label} must be a URL.`);
  }
}

function parseOptionalRpcUrls(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const urls = expectArray(value, "rpcUrls").map((url, index) => optionalUrl(url, `rpcUrls[${index}]`) as string);
  return [...new Set(urls)];
}

function parseOptionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  return expectArray(value, label).map((item, index) => expectString(item, `${label}[${index}]`));
}

function formatEth(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 4,
    useGrouping: false,
  });
}

function formatWindow(start: string | null, end: string | null): string {
  if (!start && !end) return "unknown";
  if (start && !end) return `${start} → unknown`;
  if (!start && end) return `unknown → ${end}`;
  return `${start} → ${end}`;
}

function line(label: string, value: string): void {
  console.log(chalk.gray(`  ${label.padEnd(12)} ${value}`));
}
