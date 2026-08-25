import {
  parseEncryptedLaunchVaultBackup,
  type EncryptedLaunchVaultBackup,
} from "./encrypted-launch-vault";

export const MAX_LAUNCH_VAULT_BACKUP_BYTES = 1024 * 1024;
export const RESTORE_REPLACE_CONFIRMATION = "REPLACE VAULT";

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

export function prepareLaunchVaultBackupRestore(
  raw: string,
  hasExistingBackup: boolean,
  confirmation: string,
): EncryptedLaunchVaultBackup {
  const backup = parseLaunchVaultBackupRestore(raw);
  if (hasExistingBackup && confirmation !== RESTORE_REPLACE_CONFIRMATION) {
    throw new Error(`Type “${RESTORE_REPLACE_CONFIRMATION}” exactly to replace the encrypted browser vault.`);
  }
  return backup;
}
