import {
  LAUNCH_VAULT_STORAGE_KEY,
  decryptLaunchVaultBackup,
  maskVaultAddress,
  parseEncryptedLaunchVaultBackup,
  serializeEncryptedLaunchVaultBackup,
  validateLaunchVaultPayload,
  type EncryptedLaunchVaultBackup,
  type LaunchVaultPayload,
} from "./encrypted-launch-vault";

export const MAX_LAUNCH_VAULT_BACKUP_BYTES = 1024 * 1024;

export type LaunchVaultRestoreSummary = {
  launchId: string;
  launchName: string;
  walletCount: number;
  maskedAddresses: string[];
  createdAt: number;
  updatedAt: number;
};

export type AuthenticatedLaunchVaultRestore = {
  backup: EncryptedLaunchVaultBackup;
  canonicalSerialized: string;
  storageSnapshot: string | null;
  summary: LaunchVaultRestoreSummary;
  replacesExisting: boolean;
};

export type ExistingUnlockedLaunchVault = {
  encryptedBackup: EncryptedLaunchVaultBackup;
  payload: LaunchVaultPayload;
};

export type LaunchVaultRestoreStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function assertLaunchVaultBackupFileSize(size: number): void {
  if (!Number.isFinite(size) || size < 0) {
    throw new Error("Encrypted launch vault backup file size is invalid.");
  }
  if (size > MAX_LAUNCH_VAULT_BACKUP_BYTES) {
    throw new Error("Encrypted launch vault backup is too large. Choose a JSON file no larger than 1 MB.");
  }
}

export function parseLaunchVaultBackupRestore(raw: string): EncryptedLaunchVaultBackup {
  assertLaunchVaultBackupFileSize(new TextEncoder().encode(raw).byteLength);
  const parsed = parseEncryptedLaunchVaultBackup(raw);

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

export async function authenticateLaunchVaultBackupRestore({
  raw,
  candidatePassphrase,
  storageSnapshot,
  existingVault,
}: {
  raw: string;
  candidatePassphrase: string;
  storageSnapshot: string | null;
  existingVault: ExistingUnlockedLaunchVault | null;
}): Promise<AuthenticatedLaunchVaultRestore> {
  const backup = parseLaunchVaultBackupRestore(raw);
  const canonicalSerialized = serializeEncryptedLaunchVaultBackup(backup);

  // AES-GCM authentication and deep payload validation both happen before a
  // commit candidate exists. The passphrase is used only by this call.
  const payload = await decryptLaunchVaultBackup(backup, candidatePassphrase);
  validateLaunchVaultPayload(payload);

  if (storageSnapshot !== null) {
    if (!existingVault) {
      throw new Error("Unlock the current browser vault before authenticating a replacement backup.");
    }
    validateExistingVaultMatchesStorage(storageSnapshot, existingVault);
    assertNoSameLaunchRollbackOrConflict(existingVault, backup, payload);
  }

  return {
    backup,
    canonicalSerialized,
    storageSnapshot,
    summary: {
      launchId: payload.launchId,
      launchName: payload.launchName,
      walletCount: payload.wallets.length,
      maskedAddresses: payload.wallets.map((wallet) => maskVaultAddress(wallet.address)),
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    },
    replacesExisting: storageSnapshot !== null,
  };
}

export function expectedLaunchVaultRestoreConfirmation(prepared: AuthenticatedLaunchVaultRestore): string {
  return `REPLACE ${prepared.summary.launchId}`;
}

export function commitAuthenticatedLaunchVaultRestore({
  prepared,
  confirmation,
  storage,
}: {
  prepared: AuthenticatedLaunchVaultRestore;
  confirmation: string;
  storage: LaunchVaultRestoreStorage;
}): EncryptedLaunchVaultBackup {
  if (prepared.replacesExisting) {
    const expected = expectedLaunchVaultRestoreConfirmation(prepared);
    if (confirmation !== expected) {
      throw new Error(`Type “${expected}” exactly to replace the encrypted browser vault.`);
    }
  }

  // This is deliberately the final operation before the single storage write.
  // Exact-byte comparison detects another tab or action changing localStorage.
  const currentStorage = storage.getItem(LAUNCH_VAULT_STORAGE_KEY);
  if (currentStorage !== prepared.storageSnapshot) {
    throw new Error("The encrypted browser vault changed since restore began. Authenticate the backup again before replacing it.");
  }

  storage.setItem(LAUNCH_VAULT_STORAGE_KEY, prepared.canonicalSerialized);
  return prepared.backup;
}

function validateExistingVaultMatchesStorage(
  storageSnapshot: string,
  existingVault: ExistingUnlockedLaunchVault,
): void {
  validateLaunchVaultPayload(existingVault.payload);
  const parsedStoredBackup = parseLaunchVaultBackupRestore(storageSnapshot);
  const canonicalStoredBackup = serializeEncryptedLaunchVaultBackup(parsedStoredBackup);
  const canonicalUnlockedBackup = serializeEncryptedLaunchVaultBackup(existingVault.encryptedBackup);
  if (canonicalStoredBackup !== canonicalUnlockedBackup) {
    throw new Error("The unlocked Vault does not match the encrypted backup currently stored in this browser.");
  }
}

function assertNoSameLaunchRollbackOrConflict(
  existingVault: ExistingUnlockedLaunchVault,
  candidateBackup: EncryptedLaunchVaultBackup,
  candidatePayload: LaunchVaultPayload,
): void {
  const existingPayload = existingVault.payload;
  if (candidatePayload.launchId !== existingPayload.launchId) return;

  // Only authenticated plaintext timestamps participate in rollback checks.
  // Envelope header timestamps are intentionally ignored.
  if (candidatePayload.updatedAt < existingPayload.updatedAt) {
    throw new Error("This authenticated backup is older than the current same-launch Vault. Restore blocked to prevent rollback.");
  }
  if (
    candidatePayload.updatedAt === existingPayload.updatedAt &&
    candidateBackup.ciphertext !== existingVault.encryptedBackup.ciphertext
  ) {
    throw new Error("Same-launch restore conflict: the authenticated payload has the same updatedAt but different ciphertext. Resolve the conflict explicitly before restoring.");
  }
}
