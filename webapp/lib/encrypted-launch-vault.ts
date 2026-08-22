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

const PRIVATE_KEY_TOKEN_RE = /(?:0x)?[0-9a-fA-F]{64}/g;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
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
  return {
    id: `vault-${createdAt}-${index}-${imported.address.slice(2, 8).toLowerCase()}`,
    label: imported.label,
    chain: imported.chain,
    address: imported.address,
    privateKey: imported.privateKey,
    createdAt: createdAt + index,
  };
}

export function mergeVaultWallets(
  current: LaunchVaultPayload,
  imported: ParsedPrivateKeyImport[],
  now = Date.now(),
): { payload: LaunchVaultPayload; added: number; duplicates: number } {
  const seen = new Set(current.wallets.map((wallet) => wallet.address.toLowerCase()));
  const records: LaunchVaultWalletSecret[] = [];
  let duplicates = 0;

  imported.forEach((wallet) => {
    const key = wallet.address.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      return;
    }

    seen.add(key);
    records.push(buildVaultWalletRecord(wallet, now, records.length));
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
  const payload = JSON.parse(new TextDecoder().decode(plaintext)) as LaunchVaultPayload;
  assertLaunchVaultPayload(payload);
  return payload;
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
    throw new Error("Enter a 64-byte hex private key. It will be sealed immediately and never displayed back.");
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

function assertEncryptedBackup(backup: EncryptedLaunchVaultBackup): asserts backup is EncryptedLaunchVaultBackup {
  if (!backup || backup.kind !== LAUNCH_VAULT_BACKUP_KIND) {
    throw new Error("This is not a Compas launch vault backup.");
  }
  if (
    backup.header?.version !== LAUNCH_VAULT_VERSION ||
    backup.header.cipher !== LAUNCH_VAULT_CIPHER ||
    backup.header.kdf !== LAUNCH_VAULT_KDF ||
    backup.header.iterations !== LAUNCH_VAULT_ITERATIONS ||
    typeof backup.header.salt !== "string" ||
    typeof backup.header.iv !== "string" ||
    typeof backup.ciphertext !== "string"
  ) {
    throw new Error("Launch vault backup metadata is unsupported or incomplete.");
  }
}

function assertLaunchVaultPayload(payload: LaunchVaultPayload): asserts payload is LaunchVaultPayload {
  if (!payload || payload.version !== LAUNCH_VAULT_VERSION || typeof payload.launchId !== "string") {
    throw new Error("Launch vault payload is unsupported.");
  }
  if (!Array.isArray(payload.wallets)) {
    throw new Error("Launch vault wallet list is missing.");
  }
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
