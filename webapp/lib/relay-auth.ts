import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { isEthAddress } from "./compas-gate";

export const RELAY_AUTH_TOKEN_PREFIX = "relay-hmac-v1";
export const RELAY_AUTH_SCHEMA_VERSION = "compas.relay-auth.v1";
export const RELAY_AUTH_ENV_KEY = "COMPAS_RELAY_AUTH_SECRET";
export const RELAY_AUTH_DEFAULT_TTL_MS = 2 * 60 * 1000;
export const RELAY_AUTH_MAX_TTL_MS = 5 * 60 * 1000;
export const RELAY_AUTH_MAX_TRANSACTION_COUNT = 25;

const RELAY_AUTH_AUDIENCE = "compas-relay";
const RELAY_AUTH_ISSUER = "compas-mint-kit/vercel";
const LAUNCH_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,70}[a-z0-9])?$/;
const FORBIDDEN_REQUEST_KEYS = new Set([
  "accessToken",
  "apiKey",
  "authorization",
  "bearer",
  "bearerToken",
  "calldata",
  "cookie",
  "cookies",
  "holderAddress",
  "mnemonic",
  "password",
  "privateKey",
  "rawTransaction",
  "rawTransactions",
  "rawTx",
  "rpcUrl",
  "rpcUrls",
  "secret",
  "secretKey",
  "seed",
  "seedPhrase",
  "signature",
  "signedTransaction",
  "signedTransactions",
  "signedTx",
  "token",
  "walletKey",
]);

export type RelayAuthPurpose = "broadcast" | "arm";

export type RelayAuthIssueInput = {
  holderAddress: string;
  launchId: string;
  chainId: number;
  maxTransactionCount: number;
  purpose: RelayAuthPurpose;
  ttlMs?: number;
};

export type RelayAuthRequestInput = Omit<RelayAuthIssueInput, "holderAddress" | "ttlMs"> & {
  ttlMs?: number;
};

export type RelayAuthPayload = {
  schemaVersion: typeof RELAY_AUTH_SCHEMA_VERSION;
  issuer: typeof RELAY_AUTH_ISSUER;
  audience: typeof RELAY_AUTH_AUDIENCE;
  holderAddress: string;
  launchId: string;
  chainId: number;
  maxTransactionCount: number;
  purpose: RelayAuthPurpose;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export type IssuedRelayAuthToken = RelayAuthPayload & {
  token: string;
  tokenType: typeof RELAY_AUTH_TOKEN_PREFIX;
};

export type RelayAuthVerifyOptions = {
  now?: number;
  secret?: string | null;
  env?: NodeJS.ProcessEnv;
  expectedPurpose: RelayAuthPurpose;
  expectedChainId: number;
  transactionCount: number;
  expectedHolderAddress?: string;
  expectedLaunchId?: string;
};

export type RelayAuthFailureReason =
  | "secret-missing"
  | "malformed"
  | "bad-signature"
  | "invalid-payload"
  | "expired"
  | "chain-mismatch"
  | "purpose-mismatch"
  | "transaction-count-exceeded"
  | "holder-mismatch"
  | "launch-mismatch";

export type RelayAuthVerification =
  | { ok: true; payload: RelayAuthPayload }
  | { ok: false; reason: RelayAuthFailureReason };

export function relayAuthSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[RELAY_AUTH_ENV_KEY]?.trim();
  return value ? value : null;
}

export function createRelayAuthToken(input: RelayAuthIssueInput, now = Date.now(), secret = relayAuthSecret()): string {
  return issueRelayAuthToken(input, { now, secret }).token;
}

export function issueRelayAuthToken(
  input: RelayAuthIssueInput,
  options: { now?: number; secret?: string | null } = {},
): IssuedRelayAuthToken {
  const secret = Object.prototype.hasOwnProperty.call(options, "secret")
    ? options.secret?.trim() || null
    : relayAuthSecret();
  if (!secret) throw new Error(`${RELAY_AUTH_ENV_KEY} is required to issue relay auth tokens.`);

  const now = normalizeTimestamp(options.now ?? Date.now(), "now");
  const ttlMs = normalizeTtl(input.ttlMs);
  const payload: RelayAuthPayload = {
    schemaVersion: RELAY_AUTH_SCHEMA_VERSION,
    issuer: RELAY_AUTH_ISSUER,
    audience: RELAY_AUTH_AUDIENCE,
    holderAddress: normalizeHolderAddress(input.holderAddress),
    launchId: normalizeLaunchId(input.launchId),
    chainId: normalizeChainId(input.chainId),
    maxTransactionCount: normalizeMaxTransactionCount(input.maxTransactionCount),
    purpose: normalizePurpose(input.purpose),
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: randomBytes(16).toString("base64url"),
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = signRelayBody(body, secret);
  return { ...payload, token: `${RELAY_AUTH_TOKEN_PREFIX}.${body}.${signature}`, tokenType: RELAY_AUTH_TOKEN_PREFIX };
}

export function verifyRelayAuthToken(token: string, options: RelayAuthVerifyOptions): RelayAuthVerification {
  const secret = (options.secret ?? relayAuthSecret(options.env))?.trim() || null;
  if (!secret) return { ok: false, reason: "secret-missing" };

  const [prefix, body, signature, extra] = token.split(".");
  if (prefix !== RELAY_AUTH_TOKEN_PREFIX || !body || !signature || extra !== undefined) return { ok: false, reason: "malformed" };
  const expectedSignature = signRelayBody(body, secret);
  if (!safeEqual(expectedSignature, signature)) return { ok: false, reason: "bad-signature" };

  const payload = decodeRelayPayload(body);
  if (!payload) return { ok: false, reason: "invalid-payload" };

  let expectedChainId: number;
  let expectedPurpose: RelayAuthPurpose;
  let transactionCount: number;
  let expectedHolderAddress: string | undefined;
  let expectedLaunchId: string | undefined;
  try {
    expectedChainId = normalizeChainId(options.expectedChainId);
    expectedPurpose = normalizePurpose(options.expectedPurpose);
    transactionCount = normalizeTransactionCount(options.transactionCount);
    expectedHolderAddress = options.expectedHolderAddress ? normalizeHolderAddress(options.expectedHolderAddress) : undefined;
    expectedLaunchId = options.expectedLaunchId ? normalizeLaunchId(options.expectedLaunchId) : undefined;
  } catch {
    return { ok: false, reason: "invalid-payload" };
  }

  const now = normalizeTimestamp(options.now ?? Date.now(), "now");
  if (payload.expiresAt <= now) return { ok: false, reason: "expired" };
  if (payload.chainId !== expectedChainId) return { ok: false, reason: "chain-mismatch" };
  if (payload.purpose !== expectedPurpose) return { ok: false, reason: "purpose-mismatch" };
  if (transactionCount > payload.maxTransactionCount) return { ok: false, reason: "transaction-count-exceeded" };
  if (expectedHolderAddress && payload.holderAddress !== expectedHolderAddress) return { ok: false, reason: "holder-mismatch" };
  if (expectedLaunchId && payload.launchId !== expectedLaunchId) return { ok: false, reason: "launch-mismatch" };

  return { ok: true, payload };
}

export function parseRelayAuthRequest(value: unknown): RelayAuthRequestInput {
  assertNoRelayRequestSecrets(value);
  if (!isRecord(value)) throw new Error("Relay token request must be a JSON object.");
  return {
    launchId: normalizeLaunchId(value.launchId),
    chainId: normalizeChainId(value.chainId),
    maxTransactionCount: normalizeMaxTransactionCount(value.maxTransactionCount),
    purpose: normalizePurpose(value.purpose),
    ttlMs: value.ttlMs === undefined ? undefined : normalizeTtl(value.ttlMs),
  };
}

function decodeRelayPayload(body: string): RelayAuthPayload | null {
  try {
    const value = JSON.parse(base64UrlDecode(body)) as unknown;
    if (!isRecord(value)) return null;
    if (value.schemaVersion !== RELAY_AUTH_SCHEMA_VERSION || value.issuer !== RELAY_AUTH_ISSUER || value.audience !== RELAY_AUTH_AUDIENCE) return null;
    return {
      schemaVersion: RELAY_AUTH_SCHEMA_VERSION,
      issuer: RELAY_AUTH_ISSUER,
      audience: RELAY_AUTH_AUDIENCE,
      holderAddress: normalizeHolderAddress(value.holderAddress),
      launchId: normalizeLaunchId(value.launchId),
      chainId: normalizeChainId(value.chainId),
      maxTransactionCount: normalizeMaxTransactionCount(value.maxTransactionCount),
      purpose: normalizePurpose(value.purpose),
      issuedAt: normalizeTimestamp(value.issuedAt, "issuedAt"),
      expiresAt: normalizeTimestamp(value.expiresAt, "expiresAt"),
      nonce: normalizeNonce(value.nonce),
    };
  } catch {
    return null;
  }
}

function assertNoRelayRequestSecrets(value: unknown, path = "request"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRelayRequestSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && isSecretShapedValue(value)) throw new Error(`Forbidden relay token request value at ${path}.`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_REQUEST_KEYS.has(key) || /secret|token|private|mnemonic|seed|cookie|signature|authorization/i.test(key)) {
      throw new Error(`Forbidden relay token request field: ${path}.${key}`);
    }
    assertNoRelayRequestSecrets(child, `${path}.${key}`);
  }
}

function isSecretShapedValue(value: string): boolean {
  return /0x(?:02|01|f8|f9)[0-9a-fA-F]{120,}/.test(value) || /(?:^|[^0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?:$|[^0-9a-fA-F])/.test(value);
}

function normalizeHolderAddress(value: unknown): string {
  if (typeof value !== "string" || !isEthAddress(value)) throw new Error("Relay token holderAddress must be a valid 0x address.");
  return value.toLowerCase();
}

function normalizeLaunchId(value: unknown): string {
  if (typeof value !== "string") throw new Error("Relay token launchId is required.");
  const launchId = value.trim().toLowerCase();
  if (!LAUNCH_ID_RE.test(launchId)) throw new Error("Relay token launchId must be a canonical ASCII slug of at most 72 characters.");
  return launchId;
}

function normalizeChainId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Relay token chainId must be a positive integer.");
  return value;
}

function normalizeMaxTransactionCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > RELAY_AUTH_MAX_TRANSACTION_COUNT) {
    throw new Error(`Relay token maxTransactionCount must be between 1 and ${RELAY_AUTH_MAX_TRANSACTION_COUNT}.`);
  }
  return value;
}

function normalizeTransactionCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > RELAY_AUTH_MAX_TRANSACTION_COUNT) {
    throw new Error(`Relay verification transactionCount must be between 0 and ${RELAY_AUTH_MAX_TRANSACTION_COUNT}.`);
  }
  return value;
}

function normalizePurpose(value: unknown): RelayAuthPurpose {
  if (value === "broadcast" || value === "arm") return value;
  throw new Error("Relay token purpose must be broadcast or arm.");
}

function normalizeTtl(value: unknown): number {
  const ttlMs = value === undefined ? RELAY_AUTH_DEFAULT_TTL_MS : value;
  if (typeof ttlMs !== "number" || !Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > RELAY_AUTH_MAX_TTL_MS) {
    throw new Error(`Relay token ttlMs must be between 1000 and ${RELAY_AUTH_MAX_TTL_MS}.`);
  }
  return ttlMs;
}

function normalizeTimestamp(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Relay token ${label} must be a non-negative integer timestamp.`);
  return value;
}

function normalizeNonce(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(value)) throw new Error("Relay token nonce is invalid.");
  return value;
}

function signRelayBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${RELAY_AUTH_TOKEN_PREFIX}.${body}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
