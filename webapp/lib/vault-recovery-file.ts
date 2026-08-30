import {
  LAUNCH_VAULT_STORAGE_KEY,
  parseEncryptedLaunchVaultBackup,
  serializeEncryptedLaunchVaultBackup,
  type EncryptedLaunchVaultBackup,
} from "./encrypted-launch-vault";

/**
 * The `.compas-vault` recovery file: a versioned, metadata-carrying envelope
 * around the exact encrypted launch vault blob already stored in this browser.
 * It contains ciphertext only — never plaintext keys and never the passphrase.
 */
export const VAULT_RECOVERY_FILE_KIND = "compas-vault";
export const VAULT_RECOVERY_FILE_VERSION = 1;
export const VAULT_RECOVERY_FILE_EXTENSION = ".compas-vault";
export const VAULT_RECOVERY_CONFIRMATION_STORAGE_KEY = "compas-launch-vault:recovery-confirmed:v1";

export type VaultRecoveryFile = {
  kind: typeof VAULT_RECOVERY_FILE_KIND;
  formatVersion: typeof VAULT_RECOVERY_FILE_VERSION;
  vaultId: string;
  createdAt: string;
  vault: EncryptedLaunchVaultBackup;
};

export type VaultRecoveryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

/**
 * Deterministic public identifier for one sealed encrypted blob. Derived from
 * the random AES-GCM salt, so it changes on every re-seal and reveals nothing
 * about the plaintext. Re-sealing the vault therefore invalidates a previous
 * "I saved my recovery file" confirmation, which is the safe behavior.
 */
export function vaultRecoveryVaultId(backup: EncryptedLaunchVaultBackup): string {
  return `vault-${bytesToHex(base64ToBytes(backup.header.salt))}`;
}

export function buildVaultRecoveryFile(backup: EncryptedLaunchVaultBackup, now: Date = new Date()): VaultRecoveryFile {
  const canonical = canonicalizeEncryptedBackup(backup);
  const createdAt = now.toISOString();
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("Recovery file createdAt timestamp is invalid.");
  }
  return {
    kind: VAULT_RECOVERY_FILE_KIND,
    formatVersion: VAULT_RECOVERY_FILE_VERSION,
    vaultId: vaultRecoveryVaultId(canonical),
    createdAt,
    vault: canonical,
  };
}

export function serializeVaultRecoveryFile(file: VaultRecoveryFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function vaultRecoveryFileName(file: VaultRecoveryFile): string {
  const shortId = file.vaultId.replace(/^vault-/, "").slice(0, 12) || "backup";
  return `compas-vault-${shortId}${VAULT_RECOVERY_FILE_EXTENSION}`;
}

/**
 * Strict parser for `.compas-vault` recovery files. Rejects anything that is
 * not the exact supported format and rebuilds only allowlisted fields, so
 * injected plaintext-like or unknown properties cannot survive parsing.
 */
export function parseVaultRecoveryFile(raw: string): VaultRecoveryFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("This is not a valid Compas recovery file. Expected JSON.");
  }
  if (!isRecord(parsed) || parsed.kind !== VAULT_RECOVERY_FILE_KIND) {
    throw new Error("This is not a Compas Vault recovery file.");
  }
  if (parsed.formatVersion !== VAULT_RECOVERY_FILE_VERSION) {
    throw new Error("This Compas recovery file uses an unsupported format version.");
  }
  if (typeof parsed.createdAt !== "string" || Number.isNaN(Date.parse(parsed.createdAt))) {
    throw new Error("Compas recovery file createdAt metadata is invalid.");
  }
  if (typeof parsed.vaultId !== "string" || parsed.vaultId.length === 0) {
    throw new Error("Compas recovery file vaultId metadata is missing.");
  }
  if (!isRecord(parsed.vault)) {
    throw new Error("Compas recovery file is missing its encrypted vault blob.");
  }
  const vault = canonicalizeEncryptedBackup(
    parseEncryptedLaunchVaultBackup(JSON.stringify(parsed.vault)),
  );
  if (parsed.vaultId !== vaultRecoveryVaultId(vault)) {
    throw new Error("Compas recovery file vaultId does not match its encrypted vault blob.");
  }
  return {
    kind: VAULT_RECOVERY_FILE_KIND,
    formatVersion: VAULT_RECOVERY_FILE_VERSION,
    vaultId: parsed.vaultId,
    createdAt: parsed.createdAt,
    vault,
  };
}

/**
 * Returns the parsed recovery file when `raw` is a `.compas-vault` envelope,
 * or null when it is not one (e.g. a bare encrypted backup JSON), so callers
 * can fall back to the plain encrypted-backup parser. A malformed envelope
 * that claims to be a recovery file still throws.
 */
export function parseVaultRecoveryFileOrNull(raw: string): VaultRecoveryFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.kind !== VAULT_RECOVERY_FILE_KIND) return null;
  return parseVaultRecoveryFile(raw);
}

export function currentVaultRecoveryId(storage: VaultRecoveryStorage): string | null {
  const raw = storage.getItem(LAUNCH_VAULT_STORAGE_KEY);
  if (raw === null) return null;
  try {
    return vaultRecoveryVaultId(parseEncryptedLaunchVaultBackup(raw));
  } catch {
    return null;
  }
}

/**
 * True only when the persisted confirmation matches the exact sealed blob
 * currently in storage. Any re-seal, restore, or wipe changes the derived
 * vaultId, so the flag can never vouch for a blob that was never saved.
 */
export function isVaultRecoveryConfirmed(storage: VaultRecoveryStorage): boolean {
  const vaultId = currentVaultRecoveryId(storage);
  if (!vaultId) return false;
  return storage.getItem(VAULT_RECOVERY_CONFIRMATION_STORAGE_KEY) === vaultId;
}

export function confirmVaultRecoverySaved(storage: VaultRecoveryStorage): string {
  const vaultId = currentVaultRecoveryId(storage);
  if (!vaultId) {
    throw new Error("No encrypted launch vault exists in this browser to confirm a recovery file for.");
  }
  storage.setItem(VAULT_RECOVERY_CONFIRMATION_STORAGE_KEY, vaultId);
  return vaultId;
}

export function clearVaultRecoveryConfirmation(storage: VaultRecoveryStorage): void {
  if (storage.removeItem) {
    storage.removeItem(VAULT_RECOVERY_CONFIRMATION_STORAGE_KEY);
    return;
  }
  storage.setItem(VAULT_RECOVERY_CONFIRMATION_STORAGE_KEY, "");
}

function canonicalizeEncryptedBackup(backup: EncryptedLaunchVaultBackup): EncryptedLaunchVaultBackup {
  const parsed = parseEncryptedLaunchVaultBackup(serializeEncryptedLaunchVaultBackup(backup));
  return {
    kind: parsed.kind,
    header: {
      version: parsed.header.version,
      cipher: parsed.header.cipher,
      kdf: parsed.header.kdf,
      iterations: parsed.header.iterations,
      salt: parsed.header.salt,
      iv: parsed.header.iv,
      createdAt: parsed.header.createdAt,
      updatedAt: parsed.header.updatedAt,
    },
    ciphertext: parsed.ciphertext,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof atob === "function") {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  }
  return Uint8Array.from(Buffer.from(value, "base64"));
}
