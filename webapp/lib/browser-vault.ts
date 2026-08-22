import { Wallet } from "ethers";

export const ENCRYPTED_VAULT_WALLET_VERSION = "compas.encrypted-vault-wallet.v1";

export interface EncryptedVaultWallet {
  version: typeof ENCRYPTED_VAULT_WALLET_VERSION;
  address: string;
  cipher: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
}

export interface CreateEncryptedVaultWalletInput {
  privateKey: string;
  passphrase: string;
  createdAt?: Date;
}

const MIN_PASSPHRASE_LENGTH = 12;
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export async function createEncryptedVaultWallet(input: CreateEncryptedVaultWalletInput): Promise<EncryptedVaultWallet> {
  const passphrase = normalizePassphrase(input.passphrase);
  const wallet = new Wallet(normalizePrivateKey(input.privateKey));
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveAesKey(passphrase, salt);
  const createdAt = (input.createdAt ?? new Date()).toISOString();
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      version: ENCRYPTED_VAULT_WALLET_VERSION,
      address: wallet.address,
      privateKey: wallet.privateKey,
      createdAt,
    }),
  );
  const ciphertext = await subtleCrypto().encrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, key, plaintext);

  return {
    version: ENCRYPTED_VAULT_WALLET_VERSION,
    address: wallet.address,
    cipher: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    createdAt,
  };
}

export async function unlockEncryptedVaultWallet(vault: EncryptedVaultWallet, passphrase: string): Promise<{ address: string; privateKey: string }> {
  if (vault.version !== ENCRYPTED_VAULT_WALLET_VERSION || vault.cipher !== "AES-GCM" || vault.kdf !== "PBKDF2-SHA256") {
    throw new Error("Unsupported encrypted vault wallet format.");
  }

  const key = await deriveAesKey(normalizePassphrase(passphrase), base64ToBytes(vault.salt));
  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtleCrypto().decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(base64ToBytes(vault.iv)) },
      key,
      asArrayBuffer(base64ToBytes(vault.ciphertext)),
    );
  } catch {
    throw new Error("Unable to unlock vault wallet. Check the passphrase and try again.");
  }

  const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as { address?: string; privateKey?: string };
  if (!decoded.privateKey) throw new Error("Vault wallet is missing key material.");
  const wallet = new Wallet(normalizePrivateKey(decoded.privateKey));
  if (wallet.address.toLowerCase() !== vault.address.toLowerCase() || decoded.address?.toLowerCase() !== vault.address.toLowerCase()) {
    throw new Error("Vault wallet address does not match encrypted payload.");
  }

  return { address: wallet.address, privateKey: wallet.privateKey };
}

export function normalizePrivateKey(value: string): string {
  const raw = value.trim();
  const prefixed = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(prefixed)) throw new Error("Enter one 64-hex private key for the encrypted vault wallet.");
  return prefixed;
}

function normalizePassphrase(value: string): string {
  const passphrase = value.trim();
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Vault passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  return passphrase;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await subtleCrypto().importKey("raw", asArrayBuffer(new TextEncoder().encode(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return subtleCrypto().deriveKey(
    { name: "PBKDF2", salt: asArrayBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"] as KeyUsage[],
  );
}

function randomBytes(length: number): Uint8Array {
  const buffer = new Uint8Array(length);
  cryptoProvider().getRandomValues(buffer);
  return buffer;
}

function subtleCrypto(): SubtleCrypto {
  const subtle = cryptoProvider().subtle;
  if (!subtle) throw new Error("WebCrypto is required for encrypted vault wallets.");
  return subtle;
}

function cryptoProvider(): Crypto {
  if (!globalThis.crypto) throw new Error("WebCrypto is required for encrypted vault wallets.");
  return globalThis.crypto;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof atob === "function") {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(value, "base64"));
}
