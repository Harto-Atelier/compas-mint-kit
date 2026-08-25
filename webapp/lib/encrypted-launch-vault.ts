import { Wallet } from "ethers";

export const LAUNCH_VAULT_STORAGE_KEY = "compas-launch-vault:v1";
export const LAUNCH_VAULT_BACKUP_KIND = "compas-launch-vault";
export const LAUNCH_VAULT_VERSION = 1;
export const LAUNCH_VAULT_KDF = "PBKDF2-SHA256";
export const LAUNCH_VAULT_CIPHER = "AES-GCM";
export const LAUNCH_VAULT_ITERATIONS = 250_000;

export type LaunchVaultChain = "ETH" | "Base";

export type LaunchVaultWalletSecret = {
  id: string;
  label: string;
  chain: LaunchVaultChain;
  address: string;
  privateKey: string;
  createdAt: number;
};

export type LaunchVaultPublicWallet = Omit<LaunchVaultWalletSecret, "privateKey">;

export type LaunchVaultPayload = {
  version: typeof LAUNCH_VAULT_VERSION;
  launchId: string;
  launchName: string;
  createdAt: number;
  updatedAt: number;
  wallets: LaunchVaultWalletSecret[];
};

export type EncryptedLaunchVaultBackup = {
  kind: typeof LAUNCH_VAULT_BACKUP_KIND;
  header: {
    version: typeof LAUNCH_VAULT_VERSION;
    cipher: typeof LAUNCH_VAULT_CIPHER;
    kdf: typeof LAUNCH_VAULT_KDF;
    iterations: typeof LAUNCH_VAULT_ITERATIONS;
    salt: string;
    iv: string;
    createdAt: number;
    updatedAt: number;
  };
  ciphertext: string;
};

export type ParsedPrivateKeyImport = {
  label: string;
  chain: LaunchVaultChain;
  address: string;
  privateKey: string;
};

export type LockedLaunchVaultBackup = {
  encryptedBackup: EncryptedLaunchVaultBackup;
  payload: null;
};

export type WipedLaunchVaultBackup = {
  encryptedBackup: null;
  payload: null;
};

export type RotatedLaunchVaultBackup = {
  archived: LockedLaunchVaultBackup;
  active: {
    encryptedBackup: EncryptedLaunchVaultBackup;
    payload: LaunchVaultPayload;
  };
};

const PRIVATE_KEY_TOKEN_RE = /(?<![A-Za-z0-9_])(?:0x)?[0-9a-fA-F]{64}(?![A-Za-z0-9_])/g;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DEFAULT_LAUNCH_ID = "launch-vault";

export function createLaunchVaultPayload({
  launchId,
  launchName,
  now = Date.now(),
}: {
  launchId: string;
  launchName: string;
  now?: number;
}): LaunchVaultPayload {
  const safeLaunchName = launchName.trim() || "Untitled launch";
  const safeLaunchId = slugifyLaunchId(launchId || safeLaunchName);

  return {
    version: LAUNCH_VAULT_VERSION,
    launchId: safeLaunchId,
    launchName: safeLaunchName,
    createdAt: now,
    updatedAt: now,
    wallets: [],
  };
}

export function slugifyLaunchId(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return slug || DEFAULT_LAUNCH_ID;
}

export function toPublicLaunchWallet(wallet: LaunchVaultWalletSecret): LaunchVaultPublicWallet {
  return {
    id: wallet.id,
    label: wallet.label,
    chain: wallet.chain,
    address: wallet.address,
    createdAt: wallet.createdAt,
  };
}

export function maskVaultAddress(address: string) {
  if (!ADDRESS_RE.test(address)) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatVaultTimestamp(timestamp: number) {
  if (!Number.isFinite(timestamp)) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function deriveWalletFromPrivateKey(rawPrivateKey: string, label: string, chain: LaunchVaultChain): ParsedPrivateKeyImport {
  const privateKey = normalizePrivateKey(rawPrivateKey);
  const wallet = new Wallet(privateKey);

  return {
    label: label.trim() || "Vault wallet",
    chain,
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}

export function parsePrivateKeyBulkImport(raw: string, labelPrefix: string, chain: LaunchVaultChain): ParsedPrivateKeyImport[] {
  const keys = raw.match(PRIVATE_KEY_TOKEN_RE) ?? [];
  const prefix = labelPrefix.trim() || "Vault wallet";

  return keys.map((key, index) => deriveWalletFromPrivateKey(key, keys.length === 1 ? prefix : `${prefix} ${index + 1}`, chain));
}

export function buildVaultWalletRecord(imported: ParsedPrivateKeyImport, createdAt: number, index: number): LaunchVaultWalletSecret {
  const verified = validateImportedWallet(imported, index);
  return {
    id: `vault-${createdAt}-${index}-${verified.address.slice(2, 8).toLowerCase()}`,
    label: verified.label,
    chain: verified.chain,
    address: verified.address,
    privateKey: verified.privateKey,
    createdAt: createdAt + index,
  };
}

export function mergeVaultWallets(
  current: LaunchVaultPayload,
  imported: ParsedPrivateKeyImport[],
  now = Date.now(),
): { payload: LaunchVaultPayload; added: number; duplicates: number } {
  validateLaunchVaultPayload(current);
  assertTimestamp(now, "Launch vault updatedAt");
  const seen = new Set(current.wallets.map((wallet) => wallet.address.toLowerCase()));
  const records: LaunchVaultWalletSecret[] = [];
  let duplicates = 0;

  imported.forEach((wallet, index) => {
    const verified = validateImportedWallet(wallet, index);
    const key = verified.address.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      return;
    }

    seen.add(key);
    records.push(buildVaultWalletRecord(verified, now, records.length));
  });

  return {
    payload: {
      ...current,
      updatedAt: now,
      wallets: [...records, ...current.wallets],
    },
    added: records.length,
    duplicates,
  };
}

export async function encryptLaunchVaultPayload(
  payload: LaunchVaultPayload,
  passphrase: string,
  now = Date.now(),
): Promise<EncryptedLaunchVaultBackup> {
  assertPassphrase(passphrase);
  validateLaunchVaultPayload(payload);
  assertTimestamp(now, "Launch vault updatedAt");
  const crypto = getBrowserCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveVaultCryptoKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify({ ...payload, updatedAt: now }));
  const ciphertext = await crypto.subtle.encrypt(
    { name: LAUNCH_VAULT_CIPHER, iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext),
  );

  return {
    kind: LAUNCH_VAULT_BACKUP_KIND,
    header: {
      version: LAUNCH_VAULT_VERSION,
      cipher: LAUNCH_VAULT_CIPHER,
      kdf: LAUNCH_VAULT_KDF,
      iterations: LAUNCH_VAULT_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      createdAt: payload.createdAt,
      updatedAt: now,
    },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptLaunchVaultBackup(
  backup: EncryptedLaunchVaultBackup,
  passphrase: string,
): Promise<LaunchVaultPayload> {
  assertPassphrase(passphrase);
  assertEncryptedBackup(backup);
  const crypto = getBrowserCrypto();
  const salt = base64ToBytes(backup.header.salt);
  const iv = base64ToBytes(backup.header.iv);
  const key = await deriveVaultCryptoKey(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: LAUNCH_VAULT_CIPHER, iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(base64ToBytes(backup.ciphertext)),
  );
  const payload = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  validateLaunchVaultPayload(payload);
  return payload;
}

export function lockLaunchVaultBackup(backup: EncryptedLaunchVaultBackup): LockedLaunchVaultBackup {
  assertEncryptedBackup(backup);
  return { encryptedBackup: backup, payload: null };
}

export async function wipeLaunchVaultBackup({
  encryptedBackup,
  passphrase,
  confirmation,
}: {
  encryptedBackup: EncryptedLaunchVaultBackup;
  passphrase: string;
  confirmation: string;
}): Promise<WipedLaunchVaultBackup> {
  const payload = await decryptLaunchVaultBackup(encryptedBackup, passphrase);
  const expected = `WIPE ${payload.launchId}`;
  if (confirmation !== expected) {
    throw new Error(`Type “${expected}” exactly to wipe the encrypted launch vault.`);
  }
  return { encryptedBackup: null, payload: null };
}

export async function rotateLaunchVaultBackup({
  encryptedBackup,
  passphrase,
  nextPassphrase,
  nextLaunchId,
  nextLaunchName,
  nextWallets,
  now = Date.now(),
}: {
  encryptedBackup: EncryptedLaunchVaultBackup;
  passphrase: string;
  nextPassphrase: string;
  nextLaunchId: string;
  nextLaunchName: string;
  nextWallets: ParsedPrivateKeyImport[];
  now?: number;
}): Promise<RotatedLaunchVaultBackup> {
  const previousPayload = await decryptLaunchVaultBackup(encryptedBackup, passphrase);
  const safeNextLaunchId = slugifyLaunchId(nextLaunchId || nextLaunchName);
  if (safeNextLaunchId === previousPayload.launchId) {
    throw new Error("Rotation requires a new launch id.");
  }
  if (!Array.isArray(nextWallets)) {
    throw new Error("Rotation replacement wallets must be an array.");
  }
  if (nextWallets.length === 0) {
    throw new Error("Rotation requires at least one replacement wallet.");
  }

  const previousAddresses = new Set(previousPayload.wallets.map((wallet) => wallet.address.toLowerCase()));
  const replacementAddresses = new Set<string>();
  const verifiedWallets = nextWallets.map((wallet, index) => {
    const verified = validateImportedWallet(wallet, index);
    const address = verified.address.toLowerCase();
    if (replacementAddresses.has(address)) {
      throw new Error(`Duplicate replacement wallet address: ${verified.address}`);
    }
    if (previousAddresses.has(address)) {
      throw new Error(`Replacement wallet reuses a key from the previous launch: ${verified.address}`);
    }
    replacementAddresses.add(address);
    return verified;
  });

  const emptyPayload = createLaunchVaultPayload({
    launchId: safeNextLaunchId,
    launchName: nextLaunchName,
    now,
  });
  const merged = mergeVaultWallets(emptyPayload, verifiedWallets, now);
  if (merged.added !== nextWallets.length || merged.duplicates !== 0) {
    throw new Error("Rotation did not seal the requested number of unique replacement wallets.");
  }
  const nextBackup = await encryptLaunchVaultPayload(merged.payload, nextPassphrase, now);

  return {
    archived: lockLaunchVaultBackup(encryptedBackup),
    active: {
      encryptedBackup: nextBackup,
      payload: merged.payload,
    },
  };
}

export function parseEncryptedLaunchVaultBackup(raw: string): EncryptedLaunchVaultBackup {
  const parsed = JSON.parse(raw) as EncryptedLaunchVaultBackup;
  assertEncryptedBackup(parsed);
  return parsed;
}

export function serializeEncryptedLaunchVaultBackup(backup: EncryptedLaunchVaultBackup) {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

function normalizePrivateKey(rawPrivateKey: string) {
  const trimmed = rawPrivateKey.trim();
  const privateKey = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("Enter a 32-byte private key represented by 64 hex characters. It will be sealed immediately and never displayed back.");
  }
  return privateKey;
}

async function deriveVaultCryptoKey(passphrase: string, salt: Uint8Array) {
  const crypto = getBrowserCrypto();
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: LAUNCH_VAULT_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: LAUNCH_VAULT_CIPHER, length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function assertPassphrase(passphrase: string) {
  if (passphrase.trim().length < 12) {
    throw new Error("Use a launch vault passphrase with at least 12 characters.");
  }
}

function assertEncryptedBackup(backup: unknown): asserts backup is EncryptedLaunchVaultBackup {
  if (!isRecord(backup) || backup.kind !== LAUNCH_VAULT_BACKUP_KIND) {
    throw new Error("This is not a Compas launch vault backup.");
  }
  const header = backup.header;
  if (
    !isRecord(header) ||
    header.version !== LAUNCH_VAULT_VERSION ||
    header.cipher !== LAUNCH_VAULT_CIPHER ||
    header.kdf !== LAUNCH_VAULT_KDF ||
    header.iterations !== LAUNCH_VAULT_ITERATIONS ||
    typeof header.salt !== "string" ||
    typeof header.iv !== "string" ||
    typeof backup.ciphertext !== "string"
  ) {
    throw new Error("Launch vault backup metadata is unsupported or incomplete.");
  }
  assertTimestamp(header.createdAt, "Launch vault backup metadata createdAt");
  assertTimestamp(header.updatedAt, "Launch vault backup metadata updatedAt");
  assertBase64ByteLength(header.salt, "salt", 16);
  assertBase64ByteLength(header.iv, "iv", 12);
  assertBase64ByteLength(backup.ciphertext, "ciphertext", undefined, 17);
}

function assertBase64ByteLength(value: string, field: string, exactLength?: number, minimumLength?: number) {
  if (!BASE64_RE.test(value)) {
    throw new Error(`Launch vault backup metadata ${field} is not valid base64.`);
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(value);
  } catch {
    throw new Error(`Launch vault backup metadata ${field} is not valid base64.`);
  }
  if (exactLength !== undefined && bytes.length !== exactLength) {
    throw new Error(`Launch vault backup metadata ${field} has an invalid byte length.`);
  }
  if (minimumLength !== undefined && bytes.length < minimumLength) {
    throw new Error(`Launch vault backup metadata ${field} has an invalid byte length.`);
  }
}

export function validateLaunchVaultPayload(payload: unknown): asserts payload is LaunchVaultPayload {
  if (!isRecord(payload) || payload.version !== LAUNCH_VAULT_VERSION) {
    throw new Error("Launch vault payload is unsupported.");
  }
  assertNonEmptyString(payload.launchId, "Launch vault launchId");
  assertNonEmptyString(payload.launchName, "Launch vault launchName");
  assertTimestamp(payload.createdAt, "Launch vault createdAt");
  assertTimestamp(payload.updatedAt, "Launch vault updatedAt");
  if (!Array.isArray(payload.wallets)) {
    throw new Error("Launch vault wallet list is missing.");
  }

  const ids = new Set<string>();
  const addresses = new Set<string>();
  const privateKeys = new Set<string>();
  payload.wallets.forEach((value, index) => {
    const position = index + 1;
    if (!isRecord(value)) {
      throw new Error(`Launch vault wallet ${position} must be an object.`);
    }
    const id = assertNonEmptyString(value.id, `Launch vault wallet ${position} id`);
    assertNonEmptyString(value.label, `Launch vault wallet ${position} label`);
    if (value.chain !== "ETH" && value.chain !== "Base") {
      throw new Error(`Launch vault wallet ${position} chain must be ETH or Base.`);
    }
    if (typeof value.address !== "string" || !ADDRESS_RE.test(value.address)) {
      throw new Error(`Launch vault wallet ${position} address must be a 0x-prefixed EVM address.`);
    }
    if (typeof value.privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.privateKey)) {
      throw new Error(`Launch vault wallet ${position} private key must be a 0x-prefixed 32-byte key.`);
    }
    assertTimestamp(value.createdAt, `Launch vault wallet ${position} createdAt`);

    let derived: Wallet;
    try {
      derived = new Wallet(value.privateKey);
    } catch {
      throw new Error(`Launch vault wallet ${position} private key is invalid.`);
    }
    if (derived.address.toLowerCase() !== value.address.toLowerCase()) {
      throw new Error(`Launch vault wallet ${position} address does not match its private key.`);
    }

    const addressKey = derived.address.toLowerCase();
    const privateKey = derived.privateKey.toLowerCase();
    if (ids.has(id)) throw new Error(`Duplicate wallet id in launch vault: ${id}`);
    if (addresses.has(addressKey)) throw new Error(`Duplicate wallet address in launch vault: ${derived.address}`);
    if (privateKeys.has(privateKey)) throw new Error(`Duplicate private key in launch vault wallet ${position}.`);
    ids.add(id);
    addresses.add(addressKey);
    privateKeys.add(privateKey);
  });
}

function validateImportedWallet(wallet: unknown, index: number): ParsedPrivateKeyImport {
  const position = index + 1;
  if (!isRecord(wallet)) throw new Error(`Imported wallet ${position} must be an object.`);
  const label = assertNonEmptyString(wallet.label, `Imported wallet ${position} label`);
  if (wallet.chain !== "ETH" && wallet.chain !== "Base") {
    throw new Error(`Imported wallet ${position} chain must be ETH or Base.`);
  }
  if (typeof wallet.address !== "string" || !ADDRESS_RE.test(wallet.address)) {
    throw new Error(`Imported wallet ${position} address must be a 0x-prefixed EVM address.`);
  }
  if (typeof wallet.privateKey !== "string") {
    throw new Error(`Imported wallet ${position} private key is missing.`);
  }
  const derived = deriveWalletFromPrivateKey(wallet.privateKey, label, wallet.chain);
  if (derived.address.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Imported wallet ${position} address does not match its private key.`);
  }
  return derived;
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function assertTimestamp(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative timestamp.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function getBrowserCrypto() {
  if (typeof crypto === "undefined" || !crypto.subtle || !crypto.getRandomValues) {
    throw new Error("Encrypted launch vaults require a secure browser context with Web Crypto enabled.");
  }
  return crypto;
}
