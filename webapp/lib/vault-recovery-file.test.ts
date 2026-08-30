import assert from "node:assert/strict";
import test from "node:test";
import {
  LAUNCH_VAULT_STORAGE_KEY,
  createLaunchVaultPayload,
  decryptLaunchVaultBackup,
  encryptLaunchVaultPayload,
  serializeEncryptedLaunchVaultBackup,
  type LaunchVaultPayload,
  type LaunchVaultWalletSecret,
} from "./encrypted-launch-vault";
import { Wallet } from "ethers";
import {
  VAULT_RECOVERY_CONFIRMATION_STORAGE_KEY,
  VAULT_RECOVERY_FILE_EXTENSION,
  VAULT_RECOVERY_FILE_KIND,
  VAULT_RECOVERY_FILE_VERSION,
  buildVaultRecoveryFile,
  clearVaultRecoveryConfirmation,
  confirmVaultRecoverySaved,
  isVaultRecoveryConfirmed,
  parseVaultRecoveryFile,
  parseVaultRecoveryFileOrNull,
  serializeVaultRecoveryFile,
  vaultRecoveryFileName,
  vaultRecoveryVaultId,
  type VaultRecoveryStorage,
} from "./vault-recovery-file";
import {
  authenticateLaunchVaultBackupRestore,
  commitAuthenticatedLaunchVaultRestore,
  expectedLaunchVaultRestoreConfirmation,
  parseLaunchVaultBackupRestore,
} from "./launch-vault-backup-restore";

const PASSPHRASE = "recovery vault passphrase 001";
const CREATED_AT = 1_700_000_000_000;

function walletRecord(number: number): LaunchVaultWalletSecret {
  const privateKey = `0x${number.toString(16).padStart(64, "0")}`;
  const wallet = new Wallet(privateKey);
  return {
    id: `vault-${number}`,
    label: `Burner ${number}`,
    chain: number % 2 === 0 ? "Base" : "ETH",
    address: wallet.address,
    privateKey: wallet.privateKey,
    createdAt: CREATED_AT + number,
  };
}

function payload(launchId: string, updatedAt: number, wallets = [walletRecord(1)]): LaunchVaultPayload {
  return {
    ...createLaunchVaultPayload({ launchId, launchName: `Launch ${launchId}`, now: CREATED_AT }),
    updatedAt,
    wallets,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  let writes = 0;
  const storage: VaultRecoveryStorage & { removeItem: (key: string) => void } = {
    getItem: (key) => (values.has(key) ? (values.get(key) as string) : null),
    setItem: (key, value) => {
      writes += 1;
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return {
    storage,
    get writes() { return writes; },
    dump: () => new Map(values),
  };
}

test("recovery file export/import roundtrips to the identical encrypted blob and payload", async () => {
  const vaultPayload = payload("launch-roundtrip", CREATED_AT + 1_000, [walletRecord(1), walletRecord(2)]);
  const backup = await encryptLaunchVaultPayload(vaultPayload, PASSPHRASE, vaultPayload.updatedAt);

  const file = buildVaultRecoveryFile(backup, new Date(CREATED_AT + 2_000));
  assert.equal(file.kind, VAULT_RECOVERY_FILE_KIND);
  assert.equal(file.formatVersion, VAULT_RECOVERY_FILE_VERSION);
  assert.equal(file.createdAt, new Date(CREATED_AT + 2_000).toISOString());
  assert.equal(file.vaultId, vaultRecoveryVaultId(backup));
  assert.match(vaultRecoveryFileName(file), /^compas-vault-[0-9a-f]{12}\.compas-vault$/);
  assert.equal(vaultRecoveryFileName(file).endsWith(VAULT_RECOVERY_FILE_EXTENSION), true);

  const serialized = serializeVaultRecoveryFile(file);
  const reparsed = parseVaultRecoveryFile(serialized);
  assert.deepEqual(reparsed.vault, backup);
  assert.equal(reparsed.vaultId, file.vaultId);
  assert.equal(reparsed.createdAt, file.createdAt);

  const decrypted = await decryptLaunchVaultBackup(reparsed.vault, PASSPHRASE);
  assert.deepEqual(decrypted, { ...vaultPayload, updatedAt: vaultPayload.updatedAt });
});

test("serialized recovery file contains no plaintext key material and no passphrase", async () => {
  const wallets = [walletRecord(3), walletRecord(4)];
  const vaultPayload = payload("launch-secrets", CREATED_AT + 500, wallets);
  const backup = await encryptLaunchVaultPayload(vaultPayload, PASSPHRASE, vaultPayload.updatedAt);
  const serialized = serializeVaultRecoveryFile(buildVaultRecoveryFile(backup));

  assert.equal(serialized.includes(PASSPHRASE), false);
  assert.equal(/"privateKey"/.test(serialized), false);
  assert.equal(/"passphrase"/i.test(serialized), false);
  for (const wallet of wallets) {
    assert.equal(serialized.toLowerCase().includes(wallet.privateKey.slice(2).toLowerCase()), false);
    assert.equal(serialized.toLowerCase().includes(wallet.address.toLowerCase()), false);
  }
  // Only the allowlisted envelope fields survive serialization.
  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), ["createdAt", "formatVersion", "kind", "vault", "vaultId"]);
});

test("recovery file parser rejects wrong or tampered formats", async () => {
  const backup = await encryptLaunchVaultPayload(payload("launch-reject", CREATED_AT + 100), PASSPHRASE, CREATED_AT + 100);
  const file = buildVaultRecoveryFile(backup);

  assert.throws(() => parseVaultRecoveryFile("not-json"), /Expected JSON/);
  assert.throws(() => parseVaultRecoveryFile(JSON.stringify({ kind: "something-else" })), /not a Compas Vault recovery file/);
  assert.throws(() => parseVaultRecoveryFile(JSON.stringify({ ...file, formatVersion: 99 })), /unsupported format version/);
  assert.throws(() => parseVaultRecoveryFile(JSON.stringify({ ...file, createdAt: "yesterday" })), /createdAt metadata is invalid/);
  assert.throws(() => parseVaultRecoveryFile(JSON.stringify({ ...file, vaultId: "" })), /vaultId metadata is missing/);
  assert.throws(() => parseVaultRecoveryFile(JSON.stringify({ ...file, vault: undefined })), /missing its encrypted vault blob/);
  assert.throws(() => parseVaultRecoveryFile(JSON.stringify({ ...file, vault: { kind: "plaintext", privateKey: "0xsecret" } })), /not a Compas launch vault backup/);
  assert.throws(
    () => parseVaultRecoveryFile(JSON.stringify({ ...file, vaultId: "vault-ffffffffffffffffffffffffffffffff" })),
    /vaultId does not match/,
  );

  // Non-recovery JSON falls through as null so bare backups still work…
  assert.equal(parseVaultRecoveryFileOrNull(serializeEncryptedLaunchVaultBackup(backup)), null);
  assert.equal(parseVaultRecoveryFileOrNull("plain text"), null);
  // …but a malformed self-declared recovery file still throws.
  assert.throws(() => parseVaultRecoveryFileOrNull(JSON.stringify({ ...file, formatVersion: 99 })), /unsupported format version/);
});

test("recovery file parsing canonicalizes and strips injected plaintext-like fields", async () => {
  const backup = await encryptLaunchVaultPayload(payload("launch-inject", CREATED_AT + 100), PASSPHRASE, CREATED_AT + 100);
  const file = buildVaultRecoveryFile(backup);
  const polluted = JSON.stringify({
    ...file,
    plaintext: { privateKey: "0xinjected" },
    vault: { ...file.vault, privateKey: "0xinjected", header: { ...file.vault.header, passphrase: "leak" } },
  });

  const reparsed = parseVaultRecoveryFile(polluted);
  const reserialized = serializeVaultRecoveryFile(reparsed);
  assert.equal(reserialized.includes("injected"), false);
  assert.equal(reserialized.includes("plaintext"), false);
  assert.equal(reserialized.includes("passphrase"), false);
  assert.deepEqual(reparsed.vault, backup);
});

test("restore path accepts a .compas-vault recovery file and authenticates it end to end", async () => {
  const vaultPayload = payload("launch-restore", CREATED_AT + 3_000);
  const backup = await encryptLaunchVaultPayload(vaultPayload, PASSPHRASE, vaultPayload.updatedAt);
  const raw = serializeVaultRecoveryFile(buildVaultRecoveryFile(backup));

  // The recovery envelope unwraps to the exact same canonical encrypted backup.
  assert.deepEqual(parseLaunchVaultBackupRestore(raw), parseLaunchVaultBackupRestore(serializeEncryptedLaunchVaultBackup(backup)));

  const prepared = await authenticateLaunchVaultBackupRestore({
    raw,
    candidatePassphrase: PASSPHRASE,
    storageSnapshot: null,
    currentVaultPassphrase: null,
  });
  assert.equal(prepared.summary.launchId, "launch-restore");
  assert.equal(prepared.replacesExisting, false);

  const store = memoryStorage();
  const committed = commitAuthenticatedLaunchVaultRestore({
    prepared,
    confirmation: "",
    storage: { getItem: () => null, setItem: store.storage.setItem },
    eventTarget: new EventTarget(),
    sourceId: "test",
  });
  assert.equal(store.writes, 1);
  assert.deepEqual(committed, prepared.backup);
});

test("restoring a recovery file over an existing vault requires the current passphrase and explicit typed confirm", async () => {
  const existingPayload = payload("launch-existing", CREATED_AT + 1_000);
  const existingPassphrase = "existing vault passphrase 001";
  const existingBackup = await encryptLaunchVaultPayload(existingPayload, existingPassphrase, existingPayload.updatedAt);
  const existingSerialized = serializeEncryptedLaunchVaultBackup(existingBackup);

  const candidatePayload = payload("launch-candidate", CREATED_AT + 2_000, [walletRecord(5)]);
  const candidateBackup = await encryptLaunchVaultPayload(candidatePayload, PASSPHRASE, candidatePayload.updatedAt);
  const raw = serializeVaultRecoveryFile(buildVaultRecoveryFile(candidateBackup));

  // Occupied storage without the current vault passphrase is rejected: no silent clobber.
  await assert.rejects(
    authenticateLaunchVaultBackupRestore({
      raw,
      candidatePassphrase: PASSPHRASE,
      storageSnapshot: existingSerialized,
      currentVaultPassphrase: null,
    }),
    /current browser Vault passphrase/,
  );

  const prepared = await authenticateLaunchVaultBackupRestore({
    raw,
    candidatePassphrase: PASSPHRASE,
    storageSnapshot: existingSerialized,
    currentVaultPassphrase: existingPassphrase,
  });
  assert.equal(prepared.replacesExisting, true);
  assert.equal(expectedLaunchVaultRestoreConfirmation(prepared), "REPLACE launch-candidate");

  // Wrong confirmation performs zero writes and leaves the existing blob untouched.
  let stored: string | null = existingSerialized;
  let writes = 0;
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      writes += 1;
      stored = value;
    },
  };
  assert.throws(
    () => commitAuthenticatedLaunchVaultRestore({ prepared, confirmation: "REPLACE wrong", storage, eventTarget: new EventTarget(), sourceId: "test" }),
    /REPLACE launch-candidate/,
  );
  assert.equal(writes, 0);
  assert.equal(stored, existingSerialized);

  // Exact confirmation commits exactly one canonical write.
  commitAuthenticatedLaunchVaultRestore({ prepared, confirmation: "REPLACE launch-candidate", storage, eventTarget: new EventTarget(), sourceId: "test" });
  assert.equal(writes, 1);
  assert.equal(stored, prepared.canonicalSerialized);
});

test("recovery-saved confirmation binds to the exact stored blob and never vouches for a different one", async () => {
  const firstPayload = payload("launch-flag", CREATED_AT + 1_000);
  const firstBackup = await encryptLaunchVaultPayload(firstPayload, PASSPHRASE, firstPayload.updatedAt);
  const store = memoryStorage();

  // No vault: nothing to confirm.
  assert.equal(isVaultRecoveryConfirmed(store.storage), false);
  assert.throws(() => confirmVaultRecoverySaved(store.storage), /No encrypted launch vault/);

  store.storage.setItem(LAUNCH_VAULT_STORAGE_KEY, serializeEncryptedLaunchVaultBackup(firstBackup));
  assert.equal(isVaultRecoveryConfirmed(store.storage), false);

  const confirmedId = confirmVaultRecoverySaved(store.storage);
  assert.equal(confirmedId, vaultRecoveryVaultId(firstBackup));
  assert.equal(store.storage.getItem(VAULT_RECOVERY_CONFIRMATION_STORAGE_KEY), confirmedId);
  assert.equal(isVaultRecoveryConfirmed(store.storage), true);

  // Re-sealing produces a different blob (fresh salt): the old flag no longer counts.
  const resealedBackup = await encryptLaunchVaultPayload(firstPayload, PASSPHRASE, firstPayload.updatedAt + 1);
  store.storage.setItem(LAUNCH_VAULT_STORAGE_KEY, serializeEncryptedLaunchVaultBackup(resealedBackup));
  assert.equal(isVaultRecoveryConfirmed(store.storage), false);

  // Confirming the new blob works; clearing removes the flag.
  confirmVaultRecoverySaved(store.storage);
  assert.equal(isVaultRecoveryConfirmed(store.storage), true);
  clearVaultRecoveryConfirmation(store.storage);
  assert.equal(isVaultRecoveryConfirmed(store.storage), false);

  // A wiped vault can never read as confirmed, even with a stale flag left behind.
  store.storage.setItem(VAULT_RECOVERY_CONFIRMATION_STORAGE_KEY, vaultRecoveryVaultId(resealedBackup));
  store.storage.removeItem(LAUNCH_VAULT_STORAGE_KEY);
  assert.equal(isVaultRecoveryConfirmed(store.storage), false);
});
