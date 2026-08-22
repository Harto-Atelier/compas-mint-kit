import type { CollectionCard, StageKind, StageSource, StageStatus } from "./mint-types";

export const RUN_CONFIG_SCHEMA_ID = "https://compas.local/schemas/mint-run-config.v1.schema.json";
export const RUN_CONFIG_SCHEMA_VERSION = "compas.mint-run-config.v1";

const STAGE_IDS: StageKind[] = ["team", "gtd", "fcfs", "public"];
const STAGE_SOURCES: StageSource[] = ["onchain-seadrop", "opensea-signed-preview", "mock-preview"];
const STAGE_STATUSES: StageStatus[] = ["ended", "live", "upcoming", "unknown"];
const FORBIDDEN_KEYS = new Set([
  "privateKey",
  "privateKeys",
  "secretKey",
  "mnemonic",
  "seedPhrase",
  "signedTx",
  "signedTransaction",
  "signedTransactions",
  "rawTx",
  "rawTransaction",
  "rawTransactions",
  "transactionData",
  "calldata",
  "calldataPreview",
  "signature",
  "signatures",
].map(normalizeForbiddenKey));
const PRIVATE_KEY_LIKE_VALUE_RE = /(?:^|[\s,:'"=])(?:0x)?[a-fA-F0-9]{64}(?=$|[\s,:'"])/;
const MAX_FEE_GWEI = 10_000;
const MAX_WALLET_COUNT = 20;

export const RUN_CONFIG_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: RUN_CONFIG_SCHEMA_ID,
  title: "Compas Mint Kit RunConfig",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "createdAt", "safety", "collection", "chain", "wallets", "gas", "stages", "timing", "warnings"],
  properties: {
    schemaVersion: { const: RUN_CONFIG_SCHEMA_VERSION },
    createdAt: { type: "string", format: "date-time" },
    safety: {
      type: "object",
      additionalProperties: false,
      required: ["canBroadcast", "includesPrivateKeys", "includesSignedTransactions", "includesRawTransactions"],
      properties: {
        canBroadcast: { const: false },
        includesPrivateKeys: { const: false },
        includesSignedTransactions: { const: false },
        includesRawTransactions: { const: false },
      },
    },
    collection: {
      type: "object",
      additionalProperties: false,
      required: ["name", "address", "openseaUrl", "explorerUrl"],
      properties: {
        name: { type: "string", minLength: 1 },
        slug: { type: "string" },
        address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
        openseaUrl: { type: "string" },
        explorerUrl: { type: "string" },
      },
    },
    chain: {
      type: "object",
      additionalProperties: false,
      required: ["key", "name", "chainId", "nativeSymbol", "explorer"],
      properties: {
        key: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        chainId: { type: "integer", minimum: 1 },
        nativeSymbol: { type: "string", minLength: 1 },
        explorer: { type: "string" },
      },
    },
    wallets: {
      type: "object",
      additionalProperties: false,
      required: ["count", "aliases"],
      properties: {
        count: { type: "integer", minimum: 1, maximum: MAX_WALLET_COUNT },
        aliases: { type: "array", minItems: 1, maxItems: MAX_WALLET_COUNT, items: { type: "string", pattern: "^[a-zA-Z0-9._:-]+$" } },
      },
    },
    gas: {
      type: "object",
      additionalProperties: false,
      required: ["maxFeeGwei", "gasLimit"],
      properties: {
        maxFeeGwei: { type: "number", minimum: 0, maximum: MAX_FEE_GWEI },
        gasLimit: { type: "integer", minimum: 21000, maximum: 2000000 },
      },
    },
    drain: {
      type: "object",
      additionalProperties: false,
      required: ["address"],
      properties: {
        address: { anyOf: [{ type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, { type: "null" }] },
      },
    },
    stages: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stageId", "label", "source", "status", "quantityPerWallet", "priceEth", "maxPerWallet", "feeRecipient", "timing"],
        properties: {
          stageId: { enum: STAGE_IDS },
          label: { type: "string", minLength: 1 },
          source: { enum: STAGE_SOURCES },
          status: { enum: STAGE_STATUSES },
          quantityPerWallet: { type: "integer", minimum: 1, maximum: 100 },
          priceEth: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$" },
          maxPerWallet: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
          feeRecipient: { anyOf: [{ type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, { type: "null" }] },
          timing: {
            type: "object",
            additionalProperties: false,
            required: ["startTime", "endTime", "fireAt"],
            properties: {
              startTime: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
              endTime: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
              fireAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
            },
          },
        },
      },
    },
    timing: {
      type: "object",
      additionalProperties: false,
      required: ["fireAt", "generatedAt"],
      properties: {
        fireAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
        generatedAt: { type: "string", format: "date-time" },
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

export interface RunConfigStageInput {
  id: StageKind;
  label: string;
  source: StageSource;
  status: StageStatus;
  startTime: string | null;
  endTime: string | null;
  priceEth: string;
  maxPerWallet: number | null;
  feeRecipient?: string | null;
  warnings?: string[];
}

export interface RunConfigExportRequest {
  collection: CollectionCard;
  stages: RunConfigStageInput[];
  quantities: { stageId: StageKind; quantity: number }[];
  walletCount: number;
  walletAliases?: string[];
  maxFeeGwei: number;
  gasLimit: number;
  drainAddress?: string;
}

export interface MintRunConfig {
  schemaVersion: typeof RUN_CONFIG_SCHEMA_VERSION;
  createdAt: string;
  safety: {
    canBroadcast: false;
    includesPrivateKeys: false;
    includesSignedTransactions: false;
    includesRawTransactions: false;
  };
  collection: {
    name: string;
    slug?: string;
    address: string;
    openseaUrl: string;
    explorerUrl: string;
  };
  chain: {
    key: string;
    name: string;
    chainId: number;
    nativeSymbol: string;
    explorer: string;
  };
  wallets: {
    count: number;
    aliases: string[];
  };
  gas: {
    maxFeeGwei: number;
    gasLimit: number;
  };
  drain: {
    address: string | null;
  };
  stages: {
    stageId: StageKind;
    label: string;
    source: StageSource;
    status: StageStatus;
    quantityPerWallet: number;
    priceEth: string;
    maxPerWallet: number | null;
    feeRecipient: string | null;
    timing: {
      startTime: string | null;
      endTime: string | null;
      fireAt: string | null;
    };
  }[];
  timing: {
    fireAt: string | null;
    generatedAt: string;
  };
  warnings: string[];
}

export interface RunConfigExportResponse {
  ok: true;
  filename: string;
  config: MintRunConfig;
  schema: typeof RUN_CONFIG_JSON_SCHEMA;
}

export interface RunConfigExportError {
  ok: false;
  error: string;
}

export function buildRunConfigExport(body: unknown, now = new Date()): RunConfigExportResponse {
  assertNoForbiddenKeys(body);
  const request = parseRunConfigExportRequest(body);
  const createdAt = now.toISOString();
  const quantityByStage = new Map(request.quantities.map((item) => [item.stageId, item.quantity]));
  const selectedStages = request.stages
    .map((stage) => {
      const quantityPerWallet = clampInteger(quantityByStage.get(stage.id) ?? 0, 0, 100, `${stage.label} quantity`);
      if (quantityPerWallet === 0) return null;
      const fireAt = stage.startTime;
      return {
        stageId: stage.id,
        label: stage.label,
        source: stage.source,
        status: stage.status,
        quantityPerWallet,
        priceEth: normalizeEthString(stage.priceEth, stage.label),
        maxPerWallet: stage.maxPerWallet,
        feeRecipient: normalizeOptionalAddress(stage.feeRecipient, `${stage.label} fee recipient`),
        timing: {
          startTime: normalizeOptionalIso(stage.startTime, `${stage.label} start time`),
          endTime: normalizeOptionalIso(stage.endTime, `${stage.label} end time`),
          fireAt: normalizeOptionalIso(fireAt, `${stage.label} fire time`),
        },
      };
    })
    .filter((stage): stage is NonNullable<typeof stage> => stage !== null);

  if (selectedStages.length === 0) throw new Error("Set a quantity above zero for at least one stage.");

  const drainAddress = normalizeOptionalAddress(request.drainAddress, "sweep destination");
  const fireAt = selectedStages.map((stage) => stage.timing.fireAt).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  const warnings = buildRunConfigWarnings(request.stages, selectedStages);
  const config: MintRunConfig = {
    schemaVersion: RUN_CONFIG_SCHEMA_VERSION,
    createdAt,
    safety: {
      canBroadcast: false,
      includesPrivateKeys: false,
      includesSignedTransactions: false,
      includesRawTransactions: false,
    },
    collection: {
      name: nonEmptyString(request.collection.name, "collection name"),
      slug: request.collection.slug || undefined,
      address: normalizeAddress(request.collection.address, "collection address"),
      openseaUrl: nonEmptyString(request.collection.openseaUrl, "OpenSea URL"),
      explorerUrl: nonEmptyString(request.collection.explorerUrl, "explorer URL"),
    },
    chain: {
      key: nonEmptyString(request.collection.chain.key, "chain key"),
      name: nonEmptyString(request.collection.chain.name, "chain name"),
      chainId: clampInteger(request.collection.chain.chainId, 1, 10_000_000, "chain id"),
      nativeSymbol: nonEmptyString(request.collection.chain.nativeSymbol, "native symbol"),
      explorer: nonEmptyString(request.collection.chain.explorer, "chain explorer"),
    },
    wallets: {
      count: request.walletCount,
      aliases: request.walletAliases ?? createWalletAliases(request.walletCount),
    },
    gas: {
      maxFeeGwei: boundedNumber(request.maxFeeGwei, 0, MAX_FEE_GWEI, "max fee gwei"),
      gasLimit: clampInteger(request.gasLimit, 21_000, 2_000_000, "gas limit"),
    },
    drain: { address: drainAddress },
    stages: selectedStages,
    timing: { fireAt, generatedAt: createdAt },
    warnings,
  };

  validateRunConfig(config);
  return {
    ok: true,
    filename: `${slugify(config.collection.slug || config.collection.name)}-${config.chain.key}-run-config.json`,
    config,
    schema: RUN_CONFIG_JSON_SCHEMA,
  };
}

export function createWalletAliases(count: number, prefix = "wallet"): string[] {
  const walletCount = clampInteger(count, 1, MAX_WALLET_COUNT, "wallet count");
  return Array.from({ length: walletCount }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`);
}

export function validateRunConfig(config: MintRunConfig): void {
  assertNoForbiddenKeys(config);
  if (config.safety.canBroadcast || config.safety.includesPrivateKeys || config.safety.includesSignedTransactions || config.safety.includesRawTransactions) {
    throw new Error("RunConfig safety flags must remain no-broadcast and no-secret.");
  }
  if (config.wallets.aliases.length !== config.wallets.count) throw new Error("Wallet aliases must match wallet count.");
  for (const alias of config.wallets.aliases) {
    if (!/^[a-zA-Z0-9._:-]+$/.test(alias)) throw new Error(`Invalid wallet alias: ${alias}`);
  }
  for (const stage of config.stages) {
    if (!STAGE_IDS.includes(stage.stageId)) throw new Error(`Invalid stage id: ${stage.stageId}`);
    if (stage.quantityPerWallet < 1 || stage.quantityPerWallet > 100) throw new Error(`Invalid quantity for ${stage.label}.`);
    if (!STAGE_SOURCES.includes(stage.source)) throw new Error(`Invalid stage source for ${stage.label}.`);
    if (!STAGE_STATUSES.includes(stage.status)) throw new Error(`Invalid stage status for ${stage.label}.`);
  }
}

function parseRunConfigExportRequest(body: unknown): RunConfigExportRequest {
  const object = expectObject(body, "request body");
  const collection = expectObject(object.collection, "collection") as unknown as CollectionCard;
  const stages = expectArray(object.stages, "stages").map(parseStageInput);
  const quantities = expectArray(object.quantities, "quantities").map(parseQuantityInput);
  const walletCount = clampInteger(object.walletCount, 1, MAX_WALLET_COUNT, "wallet count");
  const walletAliases = object.walletAliases === undefined ? undefined : expectArray(object.walletAliases, "wallet aliases").map((alias) => validateAlias(String(alias)));
  if (walletAliases && walletAliases.length !== walletCount) throw new Error("Wallet aliases must match wallet count.");

  return {
    collection,
    stages,
    quantities,
    walletCount,
    walletAliases,
    maxFeeGwei: boundedNumber(object.maxFeeGwei, 0, MAX_FEE_GWEI, "max fee gwei"),
    gasLimit: clampInteger(object.gasLimit, 21_000, 2_000_000, "gas limit"),
    drainAddress: typeof object.drainAddress === "string" ? object.drainAddress : undefined,
  };
}

function parseStageInput(value: unknown): RunConfigStageInput {
  const object = expectObject(value, "stage");
  const id = expectEnum(object.id, STAGE_IDS, "stage id");
  const source = expectEnum(object.source, STAGE_SOURCES, "stage source");
  const status = expectEnum(object.status, STAGE_STATUSES, "stage status");
  return {
    id,
    label: nonEmptyString(object.label, "stage label"),
    source,
    status,
    startTime: normalizeOptionalIso(object.startTime, "stage start time"),
    endTime: normalizeOptionalIso(object.endTime, "stage end time"),
    priceEth: normalizeEthString(object.priceEth, "stage price"),
    maxPerWallet: object.maxPerWallet === null ? null : clampInteger(object.maxPerWallet, 1, 100, "max per wallet"),
    feeRecipient: typeof object.feeRecipient === "string" ? object.feeRecipient : null,
    warnings: Array.isArray(object.warnings) ? object.warnings.map(String) : [],
  };
}

function parseQuantityInput(value: unknown): { stageId: StageKind; quantity: number } {
  const object = expectObject(value, "quantity");
  return {
    stageId: expectEnum(object.stageId, STAGE_IDS, "quantity stage id"),
    quantity: clampInteger(object.quantity, 0, 100, "quantity"),
  };
}

function buildRunConfigWarnings(
  inputs: RunConfigStageInput[],
  selectedStages: MintRunConfig["stages"]
): string[] {
  const warnings = ["RunConfig export only: no private keys, signatures, raw transactions, calldata, signing, or broadcast are included."];
  for (const stage of selectedStages) {
    const input = inputs.find((candidate) => candidate.id === stage.stageId);
    if (input?.maxPerWallet !== null && input?.maxPerWallet !== undefined && stage.quantityPerWallet > input.maxPerWallet) {
      warnings.push(`${stage.label} quantity ${stage.quantityPerWallet} exceeds max ${input.maxPerWallet} per wallet and may revert.`);
    }
    if (stage.source !== "onchain-seadrop") {
      warnings.push(`${stage.label} is ${stage.source}; local CLI execution still needs wallet-specific authorization data.`);
    }
    for (const warning of input?.warnings ?? []) warnings.push(warning);
  }
  return Array.from(new Set(warnings));
}

function assertNoForbiddenKeys(value: unknown, path = "$", seen = new WeakSet<object>()): void {
  if (typeof value === "string") {
    if (PRIVATE_KEY_LIKE_VALUE_RE.test(value)) {
      throw new Error(`Forbidden private-key-shaped value at ${path}; exports cannot include secrets.`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`, seen));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(normalizeForbiddenKey(key))) throw new Error(`Forbidden RunConfig field at ${path}.${key}; exports cannot include secrets, signatures, calldata, or raw transactions.`);
    assertNoForbiddenKeys(child, `${path}.${key}`, seen);
  }
}

function normalizeForbiddenKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function expectEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`Invalid ${label}.`);
  return value as T;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Invalid ${label}.`);
  return value.trim();
}

function finiteNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label}.`);
  return number;
}

function boundedNumber(value: unknown, min: number, max: number, label: string): number {
  const number = finiteNumber(value, label);
  if (number < min || number > max) throw new Error(`Invalid ${label}; expected ${min}-${max}.`);
  return number;
}

function clampInteger(value: unknown, min: number, max: number, label: string): number {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`Invalid ${label}; expected ${min}-${max}.`);
  return number;
}

function normalizeAddress(value: unknown, label: string): string {
  const raw = nonEmptyString(value, label);
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Error(`Invalid ${label}.`);
  return raw;
}

function normalizeOptionalAddress(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return normalizeAddress(value, label);
}

function normalizeOptionalIso(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`Invalid ${label}.`);
  return new Date(value).toISOString();
}

function normalizeEthString(value: unknown, label: string): string {
  const raw = nonEmptyString(value, label);
  if (!/^[0-9]+(\.[0-9]+)?$/.test(raw)) throw new Error(`Invalid ${label}.`);
  return raw;
}

function validateAlias(value: string): string {
  if (!/^[a-zA-Z0-9._:-]+$/.test(value)) throw new Error(`Invalid wallet alias: ${value}`);
  return value;
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "mint";
}
