import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import {
  LAUNCH_VAULT_BACKUP_KIND,
  LAUNCH_VAULT_CIPHER,
  LAUNCH_VAULT_ITERATIONS,
  LAUNCH_VAULT_KDF,
  LAUNCH_VAULT_VERSION,
  buildVaultWalletRecord,
  createLaunchVaultPayload,
  decryptLaunchVaultBackup,
  deriveWalletFromPrivateKey,
  encryptLaunchVaultPayload,
  lockLaunchVaultBackup,
  mergeVaultWallets,
  parseEncryptedLaunchVaultBackup,
  parsePrivateKeyBulkImport,
  rotateLaunchVaultBackup,
  validateLaunchVaultPayload,
  wipeLaunchVaultBackup,
  type EncryptedLaunchVaultBackup,
  type LaunchVaultPayload,
  type LaunchVaultWalletSecret,
} from "./encrypted-launch-vault";

const PASSPHRASE = "correct horse launch vault";
const NEXT_PASSPHRASE = "another correct launch vault";
const CREATED_AT = 1_700_000_000_000;

function privateKey(number: number) {
  return `0x${number.toString(16).padStart(64, "0")}`;
}

function walletRecord(number: number, overrides: Partial<LaunchVaultWalletSecret> = {}): LaunchVaultWalletSecret {
  const wallet = new Wallet(privateKey(number));
  return {
    id: `vault-${number}`,
    label: `Burner ${number}`,
    chain: number % 2 === 0 ? "Base" : "ETH",
    address: wallet.address,
    privateKey: wallet.privateKey,
    createdAt: CREATED_AT + number,
    ...overrides,
  };
}

function payloadWith(wallets: LaunchVaultWalletSecret[]): LaunchVaultPayload {
  return {
    ...createLaunchVaultPayload({ launchId: "launch-a", launchName: "Launch A", now: CREATED_AT }),
    wallets,
  };
}

async function sealUncheckedPayload(payload: unknown, passphrase: string, now = CREATED_AT): Promise<EncryptedLaunchVaultBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: LAUNCH_VAULT_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: LAUNCH_VAULT_CIPHER, length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: LAUNCH_VAULT_CIPHER, iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );

  return {
    kind: LAUNCH_VAULT_BACKUP_KIND,
    header: {
      version: LAUNCH_VAULT_VERSION,
      cipher: LAUNCH_VAULT_CIPHER,
      kdf: LAUNCH_VAULT_KDF,
      iterations: LAUNCH_VAULT_ITERATIONS,
      salt: Buffer.from(salt).toString("base64"),
      iv: Buffer.from(iv).toString("base64"),
      createdAt: now,
      updatedAt: now,
    },
    ciphertext: Buffer.from(ciphertext).toString("base64"),
  };
}

test("payload validation derives every wallet address from its private key", () => {
  const payload = payloadWith([walletRecord(1), walletRecord(2)]);

  assert.doesNotThrow(() => validateLaunchVaultPayload(payload));
  for (const wallet of payload.wallets) {
    assert.equal(new Wallet(wallet.privateKey).address, wallet.address);
  }
});

test("payload validation rejects a wallet address that does not match its private key", async () => {
  const mismatched = payloadWith([walletRecord(1, { address: new Wallet(privateKey(2)).address })]);

  assert.throws(() => validateLaunchVaultPayload(mismatched), /wallet 1 address does not match.*private key/i);

  const uncheckedBackup = await sealUncheckedPayload(mismatched, PASSPHRASE);
  await assert.rejects(
    () => decryptLaunchVaultBackup(uncheckedBackup, PASSPHRASE),
    /wallet 1 address does not match.*private key/i,
  );
});

test("payload validation rejects malformed wallet records", async (t) => {
  const valid = walletRecord(1);
  const malformed: Array<[string, unknown, RegExp]> = [
    ["non-object", null, /wallet 1 must be an object/i],
    ["id", { ...valid, id: "" }, /wallet 1 id/i],
    ["label", { ...valid, label: 42 }, /wallet 1 label/i],
    ["chain", { ...valid, chain: "Polygon" }, /wallet 1 chain/i],
    ["address", { ...valid, address: "0x1234" }, /wallet 1 address/i],
    ["private key", { ...valid, privateKey: "0x1234" }, /wallet 1 private key/i],
    ["created timestamp", { ...valid, createdAt: "yesterday" }, /wallet 1 createdAt/i],
  ];

  for (const [name, record, expected] of malformed) {
    await t.test(name, () => {
      const payload = payloadWith([record as LaunchVaultWalletSecret]);
      assert.throws(() => validateLaunchVaultPayload(payload), expected);
    });
  }
});

test("payload validation rejects duplicate wallet ids and duplicate key-address pairs", () => {
  const first = walletRecord(1);
  const second = walletRecord(2, { id: first.id });
  assert.throws(() => validateLaunchVaultPayload(payloadWith([first, second])), /duplicate wallet id/i);

  const duplicateKey = walletRecord(1, { id: "vault-copy", label: "Copied burner" });
  assert.throws(() => validateLaunchVaultPayload(payloadWith([first, duplicateKey])), /duplicate wallet address/i);
});

test("payload validation rejects malformed launch metadata and wallet lists", () => {
  const valid = payloadWith([]);
  const malformed: Array<[unknown, RegExp]> = [
    [{ ...valid, launchId: "" }, /launchId/i],
    [{ ...valid, launchName: null }, /launchName/i],
    [{ ...valid, createdAt: Number.NaN }, /createdAt/i],
    [{ ...valid, updatedAt: "later" }, /updatedAt/i],
    [{ ...valid, wallets: {} }, /wallet list/i],
  ];

  for (const [payload, expected] of malformed) {
    assert.throws(() => validateLaunchVaultPayload(payload), expected);
  }
});

test("merge validates current and imported wallet key-address coherence before changing the vault", () => {
  const current = payloadWith([walletRecord(1)]);
  const mismatched = {
    label: "Replacement",
    chain: "ETH" as const,
    address: new Wallet(privateKey(3)).address,
    privateKey: privateKey(2),
  };

  assert.throws(() => mergeVaultWallets(current, [mismatched], CREATED_AT + 100), /address does not match.*private key/i);
  assert.deepEqual(current, payloadWith([walletRecord(1)]));
});

test("wallet record construction derives and verifies the imported key-address pair", () => {
  const imported = {
    label: "Burner",
    chain: "Base" as const,
    address: new Wallet(privateKey(2)).address,
    privateKey: privateKey(1),
  };

  assert.throws(
    () => buildVaultWalletRecord(imported, CREATED_AT, 0),
    /address does not match.*private key/i,
  );
});

test("bulk import rejects malformed adjacent tokens instead of truncating them into different keys", () => {
  const key = "1".repeat(64);
  assert.deepEqual(parsePrivateKeyBulkImport(`0x${"1".repeat(66)}`, "Burner", "ETH"), []);
  assert.deepEqual(parsePrivateKeyBulkImport("1".repeat(65), "Burner", "ETH"), []);
  assert.deepEqual(parsePrivateKeyBulkImport(`0x${key}zz`, "Burner", "ETH"), []);
  assert.deepEqual(parsePrivateKeyBulkImport(`x0x${key}`, "Burner", "ETH"), []);
});

test("private-key errors describe a 32-byte key represented by 64 hex characters", () => {
  assert.throws(
    () => deriveWalletFromPrivateKey("0x1234", "Burner", "ETH"),
    /32-byte.*64 hex/i,
  );
});

test("locking drops the plaintext payload while retaining the real encrypted backup", async () => {
  const payload = payloadWith([walletRecord(1)]);
  const backup = await encryptLaunchVaultPayload(payload, PASSPHRASE, CREATED_AT);

  const locked = lockLaunchVaultBackup(backup);

  assert.deepEqual(locked, { encryptedBackup: backup, payload: null });
  assert.equal(JSON.stringify(locked).includes(payload.wallets[0].privateKey), false);
  assert.deepEqual(await decryptLaunchVaultBackup(locked.encryptedBackup, PASSPHRASE), payload);
});

test("wipe requires the unlocked launch confirmation and returns no placeholder ciphertext", async () => {
  const payload = payloadWith([walletRecord(1)]);
  const backup = await encryptLaunchVaultPayload(payload, PASSPHRASE, CREATED_AT);
  const retainedDownloadedBackup = structuredClone(backup);

  await assert.rejects(
    () => wipeLaunchVaultBackup({ encryptedBackup: backup, passphrase: PASSPHRASE, confirmation: "WIPE VAULT" }),
    /type “WIPE launch-a” exactly/i,
  );

  const wiped = await wipeLaunchVaultBackup({
    encryptedBackup: backup,
    passphrase: PASSPHRASE,
    confirmation: "WIPE launch-a",
  });

  assert.deepEqual(wiped, { encryptedBackup: null, payload: null });
  assert.equal(JSON.stringify(wiped).includes("wiped-vault"), false);
  assert.deepEqual(backup, retainedDownloadedBackup);
  assert.deepEqual(await decryptLaunchVaultBackup(retainedDownloadedBackup, PASSPHRASE), payload);
});

test("rotation retains a locked real backup and seals unique replacement wallets into a new launch", async () => {
  const oldPayload = payloadWith([walletRecord(1), walletRecord(2)]);
  const oldBackup = await encryptLaunchVaultPayload(oldPayload, PASSPHRASE, CREATED_AT);
  const oldSnapshot = structuredClone(oldBackup);
  const nextWallets = [walletRecord(3), walletRecord(4)].map(({ label, chain, address, privateKey }) => ({
    label,
    chain,
    address,
    privateKey,
  }));

  const rotated = await rotateLaunchVaultBackup({
    encryptedBackup: oldBackup,
    passphrase: PASSPHRASE,
    nextPassphrase: NEXT_PASSPHRASE,
    nextLaunchId: "launch-b",
    nextLaunchName: "Launch B",
    nextWallets,
    now: CREATED_AT + 1_000,
  });

  assert.deepEqual(rotated.archived, { encryptedBackup: oldSnapshot, payload: null });
  assert.equal(rotated.active.payload.launchId, "launch-b");
  assert.equal(rotated.active.payload.wallets.length, nextWallets.length);
  assert.equal(new Set(rotated.active.payload.wallets.map((wallet) => wallet.address.toLowerCase())).size, nextWallets.length);
  assert.equal(rotated.active.payload.wallets.some((wallet) => oldPayload.wallets.some((old) => old.address.toLowerCase() === wallet.address.toLowerCase())), false);
  assert.notEqual(rotated.active.encryptedBackup.header.salt, oldBackup.header.salt);
  assert.notEqual(rotated.active.encryptedBackup.header.iv, oldBackup.header.iv);
  assert.notEqual(rotated.active.encryptedBackup.ciphertext, oldBackup.ciphertext);
  assert.deepEqual(await decryptLaunchVaultBackup(rotated.archived.encryptedBackup, PASSPHRASE), oldPayload);
  assert.deepEqual(await decryptLaunchVaultBackup(rotated.active.encryptedBackup, NEXT_PASSPHRASE), rotated.active.payload);
  await assert.rejects(() => decryptLaunchVaultBackup(rotated.active.encryptedBackup, PASSPHRASE));
});

test("rotation refuses launch-id reuse, replacement duplicates, and old key reuse without mutating the backup", async () => {
  const oldPayload = payloadWith([walletRecord(1)]);
  const oldBackup = await encryptLaunchVaultPayload(oldPayload, PASSPHRASE, CREATED_AT);
  const snapshot = structuredClone(oldBackup);
  const replacement = walletRecord(2);
  const nextWallet = ({ label, chain, address, privateKey }: LaunchVaultWalletSecret) => ({ label, chain, address, privateKey });

  await assert.rejects(
    () => rotateLaunchVaultBackup({
      encryptedBackup: oldBackup,
      passphrase: PASSPHRASE,
      nextPassphrase: NEXT_PASSPHRASE,
      nextLaunchId: oldPayload.launchId,
      nextLaunchName: "Same launch",
      nextWallets: [nextWallet(replacement)],
      now: CREATED_AT + 1_000,
    }),
    /new launch id/i,
  );

  await assert.rejects(
    () => rotateLaunchVaultBackup({
      encryptedBackup: oldBackup,
      passphrase: PASSPHRASE,
      nextPassphrase: NEXT_PASSPHRASE,
      nextLaunchId: "launch-b",
      nextLaunchName: "Launch B",
      nextWallets: [nextWallet(replacement), nextWallet({ ...replacement, id: "copy" })],
      now: CREATED_AT + 1_000,
    }),
    /duplicate replacement wallet address/i,
  );

  await assert.rejects(
    () => rotateLaunchVaultBackup({
      encryptedBackup: oldBackup,
      passphrase: PASSPHRASE,
      nextPassphrase: NEXT_PASSPHRASE,
      nextLaunchId: "launch-b",
      nextLaunchName: "Launch B",
      nextWallets: [nextWallet(oldPayload.wallets[0])],
      now: CREATED_AT + 1_000,
    }),
    /replacement wallet reuses a key from the previous launch/i,
  );

  assert.deepEqual(oldBackup, snapshot);
});

test("rotation rejects an empty replacement set rather than creating an empty key placeholder", async () => {
  const oldBackup = await encryptLaunchVaultPayload(payloadWith([walletRecord(1)]), PASSPHRASE, CREATED_AT);

  await assert.rejects(
    () => rotateLaunchVaultBackup({
      encryptedBackup: oldBackup,
      passphrase: PASSPHRASE,
      nextPassphrase: NEXT_PASSPHRASE,
      nextLaunchId: "launch-b",
      nextLaunchName: "Launch B",
      nextWallets: [],
      now: CREATED_AT + 1_000,
    }),
    /at least one replacement wallet/i,
  );
});

test("backup parsing rejects malformed timestamps, salt, iv, and ciphertext before lifecycle use", async (t) => {
  const backup = await encryptLaunchVaultPayload(payloadWith([walletRecord(1)]), PASSPHRASE, CREATED_AT);
  const malformed: Array<[string, unknown, RegExp]> = [
    ["createdAt", { ...backup, header: { ...backup.header, createdAt: "today" } }, /metadata.*createdAt/i],
    ["updatedAt", { ...backup, header: { ...backup.header, updatedAt: Number.NaN } }, /metadata.*updatedAt/i],
    ["salt encoding", { ...backup, header: { ...backup.header, salt: "not base64!" } }, /metadata.*salt/i],
    ["salt length", { ...backup, header: { ...backup.header, salt: Buffer.alloc(15).toString("base64") } }, /metadata.*salt/i],
    ["iv length", { ...backup, header: { ...backup.header, iv: Buffer.alloc(11).toString("base64") } }, /metadata.*iv/i],
    ["ciphertext", { ...backup, ciphertext: Buffer.alloc(16).toString("base64") }, /metadata.*ciphertext/i],
  ];

  for (const [name, value, expected] of malformed) {
    await t.test(name, () => {
      assert.throws(() => parseEncryptedLaunchVaultBackup(JSON.stringify(value)), expected);
    });
  }
});
