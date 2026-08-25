import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import {
  LAUNCH_VAULT_BACKUP_KIND,
  LAUNCH_VAULT_CIPHER,
  LAUNCH_VAULT_ITERATIONS,
  LAUNCH_VAULT_KDF,
  LAUNCH_VAULT_VERSION,
  createLaunchVaultPayload,
  encryptLaunchVaultPayload,
  serializeEncryptedLaunchVaultBackup,
  type EncryptedLaunchVaultBackup,
  type LaunchVaultPayload,
  type LaunchVaultWalletSecret,
} from "./encrypted-launch-vault";
import {
  authenticateLaunchVaultBackupRestore,
  commitAuthenticatedLaunchVaultRestore,
  expectedLaunchVaultRestoreConfirmation,
  parseLaunchVaultBackupRestore,
} from "./launch-vault-backup-restore";

const PASSPHRASE = "candidate launch vault passphrase";
const EXISTING_PASSPHRASE = "existing launch vault passphrase";
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

async function sealUncheckedPlaintext(
  plaintext: string,
  passphrase = PASSPHRASE,
  headerUpdatedAt = CREATED_AT,
): Promise<EncryptedLaunchVaultBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: LAUNCH_VAULT_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: LAUNCH_VAULT_CIPHER, length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt({ name: LAUNCH_VAULT_CIPHER, iv }, key, new TextEncoder().encode(plaintext));
  return {
    kind: LAUNCH_VAULT_BACKUP_KIND,
    header: {
      version: LAUNCH_VAULT_VERSION,
      cipher: LAUNCH_VAULT_CIPHER,
      kdf: LAUNCH_VAULT_KDF,
      iterations: LAUNCH_VAULT_ITERATIONS,
      salt: Buffer.from(salt).toString("base64"),
      iv: Buffer.from(iv).toString("base64"),
      createdAt: CREATED_AT,
      updatedAt: headerUpdatedAt,
    },
    ciphertext: Buffer.from(ciphertext).toString("base64"),
  };
}

function memoryStorage(initial: string | null) {
  let value = initial;
  let writes = 0;
  return {
    get value() { return value; },
    get writes() { return writes; },
    storage: {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        writes += 1;
        value = next;
      },
    },
    replaceExternally(next: string | null) { value = next; },
  };
}

test("restore authentication canonicalizes the envelope and exposes only an authenticated public summary", async () => {
  const candidatePayload = payload("launch-b", CREATED_AT + 2_000, [walletRecord(1), walletRecord(2)]);
  const backup = await encryptLaunchVaultPayload(candidatePayload, PASSPHRASE, candidatePayload.updatedAt);
  const raw = JSON.stringify({ ...backup, plaintext: candidatePayload, passphrase: PASSPHRASE });

  const parsed = parseLaunchVaultBackupRestore(raw);
  const prepared = await authenticateLaunchVaultBackupRestore({
    raw,
    candidatePassphrase: PASSPHRASE,
    storageSnapshot: null,
    existingVault: null,
  });

  assert.equal(prepared.canonicalSerialized, serializeEncryptedLaunchVaultBackup(parsed));
  assert.equal(prepared.canonicalSerialized.includes("plaintext"), false);
  assert.equal(prepared.canonicalSerialized.includes("passphrase"), false);
  assert.deepEqual(prepared.summary, {
    launchId: candidatePayload.launchId,
    launchName: candidatePayload.launchName,
    walletCount: 2,
    maskedAddresses: candidatePayload.wallets.map((wallet) => `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`),
    createdAt: candidatePayload.createdAt,
    updatedAt: candidatePayload.updatedAt,
  });
  assert.equal(JSON.stringify(prepared).includes(candidatePayload.wallets[0].privateKey), false);
  assert.equal(JSON.stringify(prepared).includes(PASSPHRASE), false);
});

test("wrong passphrase and tampered authentication tag leave exact storage bytes and the unlocked vault unchanged", async () => {
  const candidatePayload = payload("launch-b", CREATED_AT + 2_000);
  const backup = await encryptLaunchVaultPayload(candidatePayload, PASSPHRASE, candidatePayload.updatedAt);
  const tampered = { ...backup, ciphertext: `${backup.ciphertext.slice(0, -4)}AAAA` };
  const currentVault = payload("launch-a", CREATED_AT + 1_000);
  const currentBackup = await encryptLaunchVaultPayload(currentVault, EXISTING_PASSPHRASE, currentVault.updatedAt);
  const existingRaw = serializeEncryptedLaunchVaultBackup(currentBackup);
  const store = memoryStorage(existingRaw);
  const currentVaultSnapshot = structuredClone(currentVault);
  const currentBackupSnapshot = structuredClone(currentBackup);
  const existingVault = { encryptedBackup: currentBackup, payload: currentVault };

  await assert.rejects(() => authenticateLaunchVaultBackupRestore({ raw: JSON.stringify(backup), candidatePassphrase: "wrong candidate passphrase", storageSnapshot: existingRaw, existingVault }));
  await assert.rejects(() => authenticateLaunchVaultBackupRestore({ raw: JSON.stringify(tampered), candidatePassphrase: PASSPHRASE, storageSnapshot: existingRaw, existingVault }));

  assert.equal(store.value, existingRaw);
  assert.equal(store.writes, 0);
  assert.deepEqual(currentVault, currentVaultSnapshot);
  assert.deepEqual(currentBackup, currentBackupSnapshot);
});

test("malformed decrypted JSON and wallet address/key mismatch fail before storage or unlocked state changes", async () => {
  const malformedJson = await sealUncheckedPlaintext("{not-json");
  const mismatchedPayload = payload("launch-b", CREATED_AT + 2_000);
  mismatchedPayload.wallets[0] = { ...mismatchedPayload.wallets[0], address: walletRecord(2).address };
  const mismatched = await sealUncheckedPlaintext(JSON.stringify(mismatchedPayload));
  const currentVault = payload("launch-a", CREATED_AT + 1_000);
  const currentBackup = await encryptLaunchVaultPayload(currentVault, EXISTING_PASSPHRASE, currentVault.updatedAt);
  const existingRaw = serializeEncryptedLaunchVaultBackup(currentBackup);
  const store = memoryStorage(existingRaw);
  const currentVaultSnapshot = structuredClone(currentVault);
  const currentBackupSnapshot = structuredClone(currentBackup);
  const existingVault = { encryptedBackup: currentBackup, payload: currentVault };

  await assert.rejects(() => authenticateLaunchVaultBackupRestore({ raw: JSON.stringify(malformedJson), candidatePassphrase: PASSPHRASE, storageSnapshot: existingRaw, existingVault }));
  await assert.rejects(
    () => authenticateLaunchVaultBackupRestore({ raw: JSON.stringify(mismatched), candidatePassphrase: PASSPHRASE, storageSnapshot: existingRaw, existingVault }),
    /address does not match.*private key/i,
  );

  assert.equal(store.value, existingRaw);
  assert.equal(store.writes, 0);
  assert.deepEqual(currentVault, currentVaultSnapshot);
  assert.deepEqual(currentBackup, currentBackupSnapshot);
});

test("replacement requires the current stored vault to be unlocked and bound to the exact storage snapshot", async () => {
  const existingPayload = payload("launch-a", CREATED_AT + 1_000);
  const existingBackup = await encryptLaunchVaultPayload(existingPayload, EXISTING_PASSPHRASE, existingPayload.updatedAt);
  const existingRaw = serializeEncryptedLaunchVaultBackup(existingBackup);
  const candidatePayload = payload("launch-b", CREATED_AT + 2_000, [walletRecord(2)]);
  const candidateBackup = await encryptLaunchVaultPayload(candidatePayload, PASSPHRASE, candidatePayload.updatedAt);

  await assert.rejects(
    () => authenticateLaunchVaultBackupRestore({ raw: JSON.stringify(candidateBackup), candidatePassphrase: PASSPHRASE, storageSnapshot: existingRaw, existingVault: null }),
    /unlock the current browser vault/i,
  );
  const differentStoredBackup = await encryptLaunchVaultPayload(existingPayload, EXISTING_PASSPHRASE, existingPayload.updatedAt);
  await assert.rejects(
    () => authenticateLaunchVaultBackupRestore({
      raw: JSON.stringify(candidateBackup),
      candidatePassphrase: PASSPHRASE,
      storageSnapshot: serializeEncryptedLaunchVaultBackup(differentStoredBackup),
      existingVault: { encryptedBackup: existingBackup, payload: existingPayload },
    }),
    /changed|does not match/i,
  );
});

test("same-launch rollback uses decrypted payload timestamps and ignores forged header timestamps", async () => {
  const existingPayload = payload("launch-a", CREATED_AT + 5_000);
  const existingBackup = await encryptLaunchVaultPayload(existingPayload, EXISTING_PASSPHRASE, existingPayload.updatedAt);
  const existingRaw = serializeEncryptedLaunchVaultBackup(existingBackup);
  const olderPayload = payload("launch-a", CREATED_AT + 4_000, [walletRecord(2)]);
  const forgedNewHeader = await sealUncheckedPlaintext(JSON.stringify(olderPayload), PASSPHRASE, CREATED_AT + 99_000);

  await assert.rejects(
    () => authenticateLaunchVaultBackupRestore({
      raw: JSON.stringify(forgedNewHeader),
      candidatePassphrase: PASSPHRASE,
      storageSnapshot: existingRaw,
      existingVault: { encryptedBackup: existingBackup, payload: existingPayload },
    }),
    /older.*rollback/i,
  );
});

test("same timestamp with different ciphertext is blocked as an explicit conflict", async () => {
  const existingPayload = payload("launch-a", CREATED_AT + 5_000);
  const existingBackup = await encryptLaunchVaultPayload(existingPayload, EXISTING_PASSPHRASE, existingPayload.updatedAt);
  const existingRaw = serializeEncryptedLaunchVaultBackup(existingBackup);
  const conflictingPayload = payload("launch-a", existingPayload.updatedAt, [walletRecord(2)]);
  const conflictingBackup = await encryptLaunchVaultPayload(conflictingPayload, PASSPHRASE, conflictingPayload.updatedAt);

  await assert.rejects(
    () => authenticateLaunchVaultBackupRestore({
      raw: JSON.stringify(conflictingBackup),
      candidatePassphrase: PASSPHRASE,
      storageSnapshot: existingRaw,
      existingVault: { encryptedBackup: existingBackup, payload: existingPayload },
    }),
    /same updatedAt.*different ciphertext|conflict/i,
  );
});

test("commit requires candidate-specific confirmation and aborts if storage changed since authentication", async () => {
  const existingPayload = payload("launch-a", CREATED_AT + 1_000);
  const existingBackup = await encryptLaunchVaultPayload(existingPayload, EXISTING_PASSPHRASE, existingPayload.updatedAt);
  const existingRaw = serializeEncryptedLaunchVaultBackup(existingBackup);
  const candidatePayload = payload("launch-b", CREATED_AT + 2_000, [walletRecord(2)]);
  const candidateBackup = await encryptLaunchVaultPayload(candidatePayload, PASSPHRASE, candidatePayload.updatedAt);
  const prepared = await authenticateLaunchVaultBackupRestore({
    raw: JSON.stringify(candidateBackup),
    candidatePassphrase: PASSPHRASE,
    storageSnapshot: existingRaw,
    existingVault: { encryptedBackup: existingBackup, payload: existingPayload },
  });
  const store = memoryStorage(existingRaw);

  assert.equal(expectedLaunchVaultRestoreConfirmation(prepared), "REPLACE launch-b");
  assert.throws(
    () => commitAuthenticatedLaunchVaultRestore({ prepared, confirmation: "REPLACE VAULT", storage: store.storage }),
    /REPLACE launch-b/,
  );
  assert.equal(store.writes, 0);
  store.replaceExternally(`${existingRaw}\nexternal change`);
  assert.throws(
    () => commitAuthenticatedLaunchVaultRestore({ prepared, confirmation: "REPLACE launch-b", storage: store.storage }),
    /changed since restore began/i,
  );
  assert.equal(store.writes, 0);
  assert.equal(store.value, `${existingRaw}\nexternal change`);
});

test("successful commit performs one canonical storage write after the final storage re-read", async () => {
  const candidatePayload = payload("launch-b", CREATED_AT + 2_000, [walletRecord(2)]);
  const candidateBackup = await encryptLaunchVaultPayload(candidatePayload, PASSPHRASE, candidatePayload.updatedAt);
  const prepared = await authenticateLaunchVaultBackupRestore({
    raw: JSON.stringify({ ...candidateBackup, ignored: "strip me" }),
    candidatePassphrase: PASSPHRASE,
    storageSnapshot: null,
    existingVault: null,
  });
  const order: string[] = [];
  let value: string | null = null;

  const committed = commitAuthenticatedLaunchVaultRestore({
    prepared,
    confirmation: "",
    storage: {
      getItem: () => { order.push("read"); return value; },
      setItem: (_key, next) => { order.push("write"); value = next; },
    },
  });

  assert.deepEqual(order, ["read", "write"]);
  assert.equal(value, prepared.canonicalSerialized);
  assert.deepEqual(committed, candidateBackup);
});
