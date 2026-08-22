import { Wallet } from "ethers";

export const LAUNCH_VAULT_SCHEMA_VERSION = "compas.launch-vault.v1";
export const LAUNCH_VAULT_PAYLOAD_SCHEMA_VERSION = "compas.launch-vault-payload.v1";
export const LAUNCH_VAULT_STORAGE_KEY = "compas.launch-vault.encrypted.v1";
export const LAUNCH_VAULT_DEFAULT_PBKDF2_ITERATIONS = 250_000;

const AES_GCM_IV_BYTES = 12;
const PBKDF2_SALT_BYTES = 16;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export type LaunchVaultChain = "ETH" | "Base";

export interface LaunchVaultPrivateKeyInput {
  alias: string;
  privateKey: string;
  address?: string;
  chain?: string;
}

export interface LaunchVaultEntry {
  id: string;
  alias: string;
  address?: string;
  chain?: string;
  iv: string;
  ciphertext: string;
}

export interface LaunchVaultCryptoParams {
  kdf: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  cipher: "AES-GCM";
  salt: string;
}

export interface LaunchVault {
  schemaVersion: typeof LAUNCH_VAULT_SCHEMA_VERSION;
  launchId: string;
  createdAt: string;
  crypto: LaunchVaultCryptoParams;
  entries: LaunchVaultEntry[];
}

export interface LaunchVaultWallet {
  id: string;
  label: string;
  alias: string;
  address: string;
  chain: LaunchVaultChain;
  privateKey: string;
  createdAt: number;
}

export interface PublicLaunchVaultWallet {
  id: string;
  label: string;
  alias: string;
  address: string;
  chain: LaunchVaultChain;
  createdAt: number;
}

export interface LaunchVaultPayload {
  schemaVersion: typeof LAUNCH_VAULT_PAYLOAD_SCHEMA_VERSION;
  launchName: string;
  launchId: string;
  createdAt: number;
  updatedAt: number;
  wallets: LaunchVaultWallet[];
}

export interface EncryptedLaunchVaultBackup {
  schemaVersion: typeof LAUNCH_VAULT_SCHEMA_VERSION;
  launchId: string;
  createdAt: string;
  crypto: LaunchVaultCryptoParams;
  iv: string;
  ciphertext: string;
}

export interface CreateLaunchVaultRequest {
  launchId: string;
  passphrase: string;
  privateKeys: LaunchVaultPrivateKeyInput[];
  createdAt?: string;
  iterations?: number;
}

export async function createLaunchVault(request: CreateLaunchVaultRequest): Promise<LaunchVault> {
  const launchId = normalizeNonEmptyString(request.launchId, "launchId");
  const passphrase = normalizeNonEmptyString(request.passphrase, "passphrase");
  const privateKeys = normalizePrivateKeys(request.privateKeys);
  const cryptoProvider = getWebCrypto();
  const vault: LaunchVault = {
    schemaVersion: LAUNCH_VAULT_SCHEMA_VERSION,
    launchId,
    createdAt: request.createdAt ?? new Date().toISOString(),
    crypto: {
      kdf: "PBKDF2",
      hash: "SHA-256",
      iterations: normalizeIterations(request.iterations),
      cipher: "AES-GCM",
      salt: encodeBase64Url(randomBytes(cryptoProvider, PBKDF2_SALT_BYTES)),
    },
    entries: [],
  };
  const key = await deriveVaultKey(cryptoProvider, passphrase, vault.crypto, vault.launchId);

  vault.entries = await Promise.all(
    privateKeys.map(async (privateKey, index) => encryptPrivateKeyEntry(cryptoProvider, key, vault, privateKey, index)),
  );

  return vault;
}

export async function decryptLaunchVault(vaultLike: unknown, passphrase: string): Promise<LaunchVaultPrivateKeyInput[]> {
  const vault = parseLaunchVault(vaultLike);
  const cryptoProvider = getWebCrypto();
  const key = await deriveVaultKey(cryptoProvider, normalizeNonEmptyString(passphrase, "passphrase"), vault.crypto, vault.launchId);

  try {
    return await Promise.all(vault.entries.map(async (entry) => decryptPrivateKeyEntry(cryptoProvider, key, vault, entry)));
  } catch (error) {
    throw new Error("Unable to decrypt launch vault. Check the passphrase and launch scope.", { cause: error });
  }
}

export function serializeLaunchVault(vaultLike: unknown): string {
  return JSON.stringify(parseLaunchVault(vaultLike), null, 2);
}

export function isLaunchVault(value: unknown): value is LaunchVault {
  try {
    parseLaunchVault(value);
    return true;
  } catch {
    return false;
  }
}

export function createLaunchVaultPayload(input: { launchName: string; launchId: string; now?: number }): LaunchVaultPayload {
  const now = input.now ?? Date.now();
  return {
    schemaVersion: LAUNCH_VAULT_PAYLOAD_SCHEMA_VERSION,
    launchName: normalizeNonEmptyString(input.launchName, "launchName"),
    launchId: slugifyLaunchId(input.launchId || input.launchName),
    createdAt: now,
    updatedAt: now,
    wallets: [],
  };
}

export async function encryptLaunchVaultPayload(payloadLike: LaunchVaultPayload, passphrase: string, now = Date.now()): Promise<EncryptedLaunchVaultBackup> {
  const payload = normalizeLaunchVaultPayload(payloadLike);
  const cryptoProvider = getWebCrypto();
  const cryptoParams: LaunchVaultCryptoParams = {
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: LAUNCH_VAULT_DEFAULT_PBKDF2_ITERATIONS,
    cipher: "AES-GCM",
    salt: encodeBase64Url(randomBytes(cryptoProvider, PBKDF2_SALT_BYTES)),
  };
  const iv = randomBytes(cryptoProvider, AES_GCM_IV_BYTES);
  const key = await deriveVaultKey(cryptoProvider, normalizeNonEmptyString(passphrase, "passphrase"), cryptoParams, payload.launchId);
  const sealedPayload = { ...payload, updatedAt: now };
  const ciphertext = await cryptoProvider.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asArrayBuffer(iv),
      additionalData: asArrayBuffer(TEXT_ENCODER.encode(`${LAUNCH_VAULT_SCHEMA_VERSION}\u0000${payload.launchId}\u0000payload`)),
    },
    key,
    asArrayBuffer(TEXT_ENCODER.encode(JSON.stringify(sealedPayload))),
  );

  return {
    schemaVersion: LAUNCH_VAULT_SCHEMA_VERSION,
    launchId: payload.launchId,
    createdAt: new Date(now).toISOString(),
    crypto: cryptoParams,
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptLaunchVaultBackup(backupLike: unknown, passphrase: string): Promise<LaunchVaultPayload> {
  const backup = parseEncryptedLaunchVaultBackup(backupLike);
  const cryptoProvider = getWebCrypto();
  const key = await deriveVaultKey(cryptoProvider, normalizeNonEmptyString(passphrase, "passphrase"), backup.crypto, backup.launchId);

  try {
    const plaintext = await cryptoProvider.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asArrayBuffer(decodeBase64Url(backup.iv)),
        additionalData: asArrayBuffer(TEXT_ENCODER.encode(`${LAUNCH_VAULT_SCHEMA_VERSION}\u0000${backup.launchId}\u0000payload`)),
      },
      key,
      asArrayBuffer(decodeBase64Url(backup.ciphertext)),
    );
    return normalizeLaunchVaultPayload(JSON.parse(TEXT_DECODER.decode(plaintext)) as LaunchVaultPayload);
  } catch (error) {
    throw new Error("Unable to decrypt launch vault backup. Check the passphrase and launch scope.", { cause: error });
  }
}

export function serializeEncryptedLaunchVaultBackup(backupLike: unknown): string {
  return JSON.stringify(parseEncryptedLaunchVaultBackup(backupLike), null, 2);
}

export function parseEncryptedLaunchVaultBackup(raw: unknown): EncryptedLaunchVaultBackup {
  const value = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
  if (!isRecord(value)) throw new Error("Encrypted launch vault backup must be an object.");
  if (value.schemaVersion !== LAUNCH_VAULT_SCHEMA_VERSION) throw new Error("Unsupported encrypted launch vault schema version.");
  const crypto = parseCryptoParams(value.crypto);
  return {
    schemaVersion: LAUNCH_VAULT_SCHEMA_VERSION,
    launchId: normalizeNonEmptyString(value.launchId, "launchId"),
    createdAt: normalizeNonEmptyString(value.createdAt, "createdAt"),
    crypto,
    iv: normalizeBase64Url(value.iv, "iv"),
    ciphertext: normalizeBase64Url(value.ciphertext, "ciphertext"),
  };
}

export function deriveWalletFromPrivateKey(privateKey: string, label = "Launch wallet", chain: LaunchVaultChain = "ETH", createdAt = Date.now()): LaunchVaultWallet {
  return buildVaultWalletRecord({ privateKey, label, chain, createdAt });
}

export function buildVaultWalletRecord(input: { privateKey: string; label?: string; alias?: string; chain?: LaunchVaultChain; createdAt?: number }): LaunchVaultWallet {
  const privateKey = normalizePrivateKey(input.privateKey, "privateKey");
  const wallet = new Wallet(privateKey);
  const label = normalizeNonEmptyString(input.label || input.alias || "Launch wallet", "label");
  const alias = slugifyLaunchId(input.alias || label || wallet.address.slice(2, 10));
  const createdAt = input.createdAt ?? Date.now();
  return {
    id: `${alias}-${wallet.address.slice(2, 10).toLowerCase()}`,
    label,
    alias,
    address: wallet.address,
    chain: input.chain ?? "ETH",
    privateKey: wallet.privateKey,
    createdAt,
  };
}

export function parsePrivateKeyBulkImport(raw: string, labelPrefix = "Launch wallet", chain: LaunchVaultChain = "ETH"): LaunchVaultWallet[] {
  return raw
    .split(/\r?\n|,/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => PRIVATE_KEY_RE.test(part.startsWith("0x") ? part : `0x${part}`))
    .map((privateKey, index) => deriveWalletFromPrivateKey(privateKey, `${labelPrefix} ${index + 1}`, chain));
}

export function mergeVaultWallets(payloadLike: LaunchVaultPayload, imports: LaunchVaultWallet[]): { payload: LaunchVaultPayload; added: number; duplicates: number } {
  const payload = normalizeLaunchVaultPayload(payloadLike);
  const seen = new Set(payload.wallets.map((wallet) => wallet.address.toLowerCase()));
  const additions: LaunchVaultWallet[] = [];
  let duplicates = 0;

  for (const wallet of imports.map(normalizeLaunchVaultWallet)) {
    const key = wallet.address.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    additions.push(wallet);
  }

  return {
    payload: {
      ...payload,
      updatedAt: additions.length > 0 ? Date.now() : payload.updatedAt,
      wallets: [...payload.wallets, ...additions],
    },
    added: additions.length,
    duplicates,
  };
}

export function toPublicLaunchWallet(wallet: LaunchVaultWallet): PublicLaunchVaultWallet {
  const normalized = normalizeLaunchVaultWallet(wallet);
  return {
    id: normalized.id,
    label: normalized.label,
    alias: normalized.alias,
    address: normalized.address,
    chain: normalized.chain,
    createdAt: normalized.createdAt,
  };
}

export function slugifyLaunchId(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "launch";
}

export function maskVaultAddress(address: string): string {
  const trimmed = address.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

export function formatVaultTimestamp(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, " UTC");
}

async function encryptPrivateKeyEntry(
  cryptoProvider: Crypto,
  key: CryptoKey,
  vault: LaunchVault,
  privateKey: LaunchVaultPrivateKeyInput,
  index: number,
): Promise<LaunchVaultEntry> {
  const iv = randomBytes(cryptoProvider, AES_GCM_IV_BYTES);
  const entry = stripUndefined({
    id: `key-${index + 1}`,
    alias: privateKey.alias,
    address: privateKey.address,
    chain: privateKey.chain,
    iv: encodeBase64Url(iv),
    ciphertext: "",
  });
  const plaintext = TEXT_ENCODER.encode(JSON.stringify({ privateKey: privateKey.privateKey }));
  const ciphertext = await cryptoProvider.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: asArrayBuffer(iv),
      additionalData: asArrayBuffer(vaultEntryAdditionalData(vault, entry)),
    },
    key,
    asArrayBuffer(plaintext),
  );

  return {
    ...entry,
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  };
}

async function decryptPrivateKeyEntry(cryptoProvider: Crypto, key: CryptoKey, vault: LaunchVault, entry: LaunchVaultEntry): Promise<LaunchVaultPrivateKeyInput> {
  const plaintext = await cryptoProvider.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: asArrayBuffer(decodeBase64Url(entry.iv)),
      additionalData: asArrayBuffer(vaultEntryAdditionalData(vault, entry)),
    },
    key,
    asArrayBuffer(decodeBase64Url(entry.ciphertext)),
  );
  const payload = JSON.parse(TEXT_DECODER.decode(plaintext)) as { privateKey?: unknown };
  return stripUndefined({
    alias: entry.alias,
    address: entry.address,
    chain: entry.chain,
    privateKey: normalizePrivateKey(payload.privateKey, `entries.${entry.id}.privateKey`),
  });
}

async function deriveVaultKey(cryptoProvider: Crypto, passphrase: string, cryptoParams: LaunchVaultCryptoParams, launchId: string): Promise<CryptoKey> {
  const keyMaterial = await cryptoProvider.subtle.importKey(
    "raw",
    asArrayBuffer(TEXT_ENCODER.encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return cryptoProvider.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: cryptoParams.hash,
      salt: asArrayBuffer(concatBytes(TEXT_ENCODER.encode(`${LAUNCH_VAULT_SCHEMA_VERSION}\u0000${launchId}\u0000`), decodeBase64Url(cryptoParams.salt))),
      iterations: cryptoParams.iterations,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function parseLaunchVault(value: unknown): LaunchVault {
  if (!isRecord(value)) throw new Error("Launch vault must be an object.");
  if (value.schemaVersion !== LAUNCH_VAULT_SCHEMA_VERSION) throw new Error("Unsupported launch vault schema version.");
  const entries = value.entries;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Launch vault must contain encrypted entries.");
  return {
    schemaVersion: LAUNCH_VAULT_SCHEMA_VERSION,
    launchId: normalizeNonEmptyString(value.launchId, "launchId"),
    createdAt: normalizeNonEmptyString(value.createdAt, "createdAt"),
    crypto: parseCryptoParams(value.crypto),
    entries: entries.map((entry, index) => parseLaunchVaultEntry(entry, index)),
  };
}

function parseCryptoParams(value: unknown): LaunchVaultCryptoParams {
  if (!isRecord(value)) throw new Error("Launch vault crypto parameters are missing.");
  return {
    kdf: value.kdf === "PBKDF2" ? value.kdf : fail("Unsupported launch vault KDF."),
    hash: value.hash === "SHA-256" ? value.hash : fail("Unsupported launch vault hash."),
    iterations: normalizeIterations(value.iterations),
    cipher: value.cipher === "AES-GCM" ? value.cipher : fail("Unsupported launch vault cipher."),
    salt: normalizeBase64Url(value.salt, "crypto.salt"),
  };
}

function parseLaunchVaultEntry(value: unknown, index: number): LaunchVaultEntry {
  if (!isRecord(value)) throw new Error(`Launch vault entry ${index + 1} must be an object.`);
  return stripUndefined({
    id: normalizeNonEmptyString(value.id, `entries.${index}.id`),
    alias: normalizeNonEmptyString(value.alias, `entries.${index}.alias`),
    address: optionalAddress(value.address, `entries.${index}.address`),
    chain: optionalString(value.chain, `entries.${index}.chain`),
    iv: normalizeBase64Url(value.iv, `entries.${index}.iv`),
    ciphertext: normalizeBase64Url(value.ciphertext, `entries.${index}.ciphertext`),
  });
}

function normalizePrivateKeys(privateKeys: LaunchVaultPrivateKeyInput[]): LaunchVaultPrivateKeyInput[] {
  if (!Array.isArray(privateKeys) || privateKeys.length === 0) throw new Error("At least one private key is required.");
  return privateKeys.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Private key entry ${index + 1} must be an object.`);
    return stripUndefined({
      alias: normalizeNonEmptyString(entry.alias, `privateKeys.${index}.alias`),
      address: optionalAddress(entry.address, `privateKeys.${index}.address`),
      chain: optionalString(entry.chain, `privateKeys.${index}.chain`),
      privateKey: normalizePrivateKey(entry.privateKey, `privateKeys.${index}.privateKey`),
    });
  });
}

function normalizeLaunchVaultPayload(value: LaunchVaultPayload): LaunchVaultPayload {
  if (!isRecord(value)) throw new Error("Launch vault payload must be an object.");
  if (value.schemaVersion !== LAUNCH_VAULT_PAYLOAD_SCHEMA_VERSION) throw new Error("Unsupported launch vault payload schema version.");
  if (!Array.isArray(value.wallets)) throw new Error("Launch vault payload wallets must be an array.");
  return {
    schemaVersion: LAUNCH_VAULT_PAYLOAD_SCHEMA_VERSION,
    launchName: normalizeNonEmptyString(value.launchName, "launchName"),
    launchId: slugifyLaunchId(value.launchId),
    createdAt: normalizeTimestamp(value.createdAt, "createdAt"),
    updatedAt: normalizeTimestamp(value.updatedAt, "updatedAt"),
    wallets: value.wallets.map(normalizeLaunchVaultWallet),
  };
}

function normalizeLaunchVaultWallet(value: LaunchVaultWallet): LaunchVaultWallet {
  if (!isRecord(value)) throw new Error("Launch vault wallet must be an object.");
  const privateKey = normalizePrivateKey(value.privateKey, "wallet.privateKey");
  const wallet = new Wallet(privateKey);
  const address = normalizeAddress(value.address || wallet.address, "wallet.address");
  if (address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("Wallet address does not match private key.");
  const label = normalizeNonEmptyString(value.label || value.alias || "Launch wallet", "wallet.label");
  const alias = slugifyLaunchId(value.alias || label);
  return {
    id: normalizeNonEmptyString(value.id || `${alias}-${address.slice(2, 10).toLowerCase()}`, "wallet.id"),
    label,
    alias,
    address: wallet.address,
    chain: normalizeLaunchVaultChain(value.chain),
    privateKey: wallet.privateKey,
    createdAt: normalizeTimestamp(value.createdAt, "wallet.createdAt"),
  };
}

function normalizeLaunchVaultChain(value: unknown): LaunchVaultChain {
  return value === "Base" ? "Base" : "ETH";
}

function normalizePrivateKey(value: unknown, field: string): string {
  const raw = normalizeNonEmptyString(value, field);
  const privateKey = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!PRIVATE_KEY_RE.test(privateKey)) throw new Error(`${field} must be a 0x-prefixed 32-byte private key.`);
  return privateKey;
}

function normalizeAddress(value: unknown, field: string): string {
  const address = normalizeNonEmptyString(value, field);
  if (!ADDRESS_RE.test(address)) throw new Error(`${field} must be a 0x-prefixed address.`);
  return address;
}

function optionalAddress(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return normalizeAddress(value, field);
}

function normalizeNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return normalizeNonEmptyString(value, field);
}

function normalizeTimestamp(value: unknown, field: string): number {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error(`${field} must be a valid timestamp.`);
  return timestamp;
}

function normalizeIterations(value: unknown): number {
  const iterations = value === undefined ? LAUNCH_VAULT_DEFAULT_PBKDF2_ITERATIONS : Number(value);
  if (!Number.isSafeInteger(iterations) || iterations < 100_000) throw new Error("PBKDF2 iterations must be a safe integer of at least 100000.");
  return iterations;
}

function normalizeBase64Url(value: unknown, field: string): string {
  const encoded = normalizeNonEmptyString(value, field);
  decodeBase64Url(encoded);
  return encoded;
}

function getWebCrypto(): Crypto {
  const cryptoProvider = globalThis.crypto;
  if (!cryptoProvider?.subtle || typeof cryptoProvider.getRandomValues !== "function") {
    throw new Error("WebCrypto is required for launch vault encryption.");
  }
  return cryptoProvider;
}

function randomBytes(cryptoProvider: Crypto, byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  cryptoProvider.getRandomValues(bytes);
  return bytes;
}

function vaultEntryAdditionalData(vault: LaunchVault, entry: Pick<LaunchVaultEntry, "id" | "alias">): Uint8Array {
  return TEXT_ENCODER.encode(`${vault.schemaVersion}\u0000${vault.launchId}\u0000${entry.id}\u0000${entry.alias}`);
}

function encodeBase64Url(bytes: Uint8Array): string {
  if (typeof btoa !== "function") throw new Error("Browser base64 encoding is unavailable.");
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid base64url value.");
  if (typeof atob !== "function") throw new Error("Browser base64 decoding is unavailable.");
  const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(message);
}
