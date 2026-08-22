import assert from "node:assert/strict";
import test from "node:test";
import {
  createLaunchVault,
  decryptLaunchVault,
  serializeLaunchVault,
  type LaunchVaultPrivateKeyInput,
} from "./launch-vault";

const PRIVATE_KEYS: LaunchVaultPrivateKeyInput[] = [
  {
    alias: "mint-ops",
    address: "0x1111111111111111111111111111111111111111",
    chain: "Base",
    privateKey: `0x${"a".repeat(64)}`,
  },
  {
    alias: "mint-backup",
    address: "0x2222222222222222222222222222222222222222",
    chain: "Ethereum",
    privateKey: `0x${"b".repeat(64)}`,
  },
];

test("launch vault encrypts and decrypts private keys for the same launch", async () => {
  const vault = await createLaunchVault({
    launchId: "compas-mainnet-2026-08",
    passphrase: "correct horse battery staple",
    privateKeys: PRIVATE_KEYS,
    createdAt: "2026-08-22T00:00:00.000Z",
  });

  assert.equal(vault.schemaVersion, "compas.launch-vault.v1");
  assert.equal(vault.launchId, "compas-mainnet-2026-08");
  assert.equal(vault.crypto.kdf, "PBKDF2");
  assert.equal(vault.crypto.cipher, "AES-GCM");
  assert.equal(vault.entries.length, PRIVATE_KEYS.length);
  assert.ok(vault.crypto.salt.length > 20);
  assert.ok(vault.entries.every((entry) => entry.iv.length > 12 && entry.ciphertext.length > 40));

  const decrypted = await decryptLaunchVault(vault, "correct horse battery staple");

  assert.deepEqual(decrypted, PRIVATE_KEYS);
});

test("launch vault refuses a wrong passphrase", async () => {
  const vault = await createLaunchVault({
    launchId: "compas-mainnet-2026-08",
    passphrase: "correct horse battery staple",
    privateKeys: PRIVATE_KEYS,
  });

  await assert.rejects(
    () => decryptLaunchVault(vault, "wrong passphrase"),
    /Unable to decrypt launch vault/i,
  );
});

test("serialized launch vault never contains plaintext private keys", async () => {
  const vault = await createLaunchVault({
    launchId: "compas-mainnet-2026-08",
    passphrase: "correct horse battery staple",
    privateKeys: PRIVATE_KEYS,
  });

  const serialized = serializeLaunchVault(vault);

  assert.equal(serialized.includes(PRIVATE_KEYS[0].privateKey), false);
  assert.equal(serialized.includes(PRIVATE_KEYS[0].privateKey.slice(2)), false);
  assert.equal(serialized.includes(PRIVATE_KEYS[1].privateKey), false);
  assert.equal(serialized.includes(PRIVATE_KEYS[1].privateKey.slice(2)), false);
  assert.equal(serialized.includes("privateKey"), false);

  const decrypted = await decryptLaunchVault(JSON.parse(serialized), "correct horse battery staple");
  assert.deepEqual(decrypted, PRIVATE_KEYS);
});

test("each launch vault gets a fresh salt and entry iv", async () => {
  const first = await createLaunchVault({
    launchId: "compas-mainnet-2026-08",
    passphrase: "correct horse battery staple",
    privateKeys: PRIVATE_KEYS,
  });
  const second = await createLaunchVault({
    launchId: "compas-mainnet-2026-08",
    passphrase: "correct horse battery staple",
    privateKeys: PRIVATE_KEYS,
  });

  assert.notEqual(first.crypto.salt, second.crypto.salt);
  assert.notEqual(first.entries[0].iv, second.entries[0].iv);
  assert.notEqual(first.entries[0].ciphertext, second.entries[0].ciphertext);
});
