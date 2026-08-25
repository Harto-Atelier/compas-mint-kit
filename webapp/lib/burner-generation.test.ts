import assert from "node:assert/strict";
import test from "node:test";
import {
  createLaunchVaultPayload,
  decryptLaunchVaultBackup,
  deriveWalletFromPrivateKey,
  encryptLaunchVaultPayload,
  mergeVaultWallets,
  serializeEncryptedLaunchVaultBackup,
} from "./encrypted-launch-vault";
import { generateAndSealBurners, generateBurnerWallets, normalizeBurnerCount } from "./burner-generation";

test("burner count accepts only whole numbers from 1 through 50", () => {
  assert.equal(normalizeBurnerCount(1), 1);
  assert.equal(normalizeBurnerCount(50), 50);
  assert.throws(() => normalizeBurnerCount(0), /between 1 and 50/i);
  assert.throws(() => normalizeBurnerCount(51), /between 1 and 50/i);
  assert.throws(() => normalizeBurnerCount(1.5), /whole number/i);
  assert.throws(() => normalizeBurnerCount(Number.NaN), /whole number/i);
});

test("bulk burner generation creates unique browser-local wallets labeled Burner 1 through N", () => {
  const burners = generateBurnerWallets({ count: 3, chain: "Base" });

  assert.deepEqual(burners.map((burner) => burner.label), ["Burner 1", "Burner 2", "Burner 3"]);
  assert.ok(burners.every((burner) => burner.chain === "Base"));
  assert.ok(burners.every((burner) => /^0x[0-9a-fA-F]{64}$/.test(burner.privateKey)));
  assert.ok(burners.every((burner) => /^0x[0-9a-fA-F]{40}$/.test(burner.address)));
  assert.equal(new Set(burners.map((burner) => burner.address.toLowerCase())).size, burners.length);
});

test("generated burners merge into the unlocked launch vault and are immediately re-sealed", async () => {
  const passphrase = "correct horse burner vault";
  const createdAt = 1_700_000_000_000;
  const existing = deriveWalletFromPrivateKey(`0x${"1".repeat(64)}`, "Existing wallet", "ETH");
  const initialPayload = mergeVaultWallets(
    createLaunchVaultPayload({ launchId: "compas-burners", launchName: "Compas burners", now: createdAt }),
    [existing],
    createdAt,
  ).payload;
  const initialBackup = await encryptLaunchVaultPayload(initialPayload, passphrase, createdAt);

  const generatedAt = createdAt + 1_000;
  const result = await generateAndSealBurners({
    encryptedBackup: initialBackup,
    passphrase,
    count: 2,
    chain: "Base",
    now: generatedAt,
  });

  assert.equal(result.added, 2);
  assert.equal(result.payload.wallets.length, 3);
  assert.deepEqual(result.payload.wallets.slice(0, 2).map((wallet) => wallet.label), ["Burner 1", "Burner 2"]);
  assert.equal(result.payload.wallets[2].label, "Existing wallet");
  assert.notEqual(result.encryptedBackup.header.salt, initialBackup.header.salt);
  assert.notEqual(result.encryptedBackup.header.iv, initialBackup.header.iv);
  assert.notEqual(result.encryptedBackup.ciphertext, initialBackup.ciphertext);

  const serialized = serializeEncryptedLaunchVaultBackup(result.encryptedBackup);
  assert.equal(serialized.includes("privateKey"), false);
  for (const burner of result.payload.wallets.slice(0, 2)) {
    assert.equal(serialized.includes(burner.privateKey), false);
    assert.equal(serialized.includes(burner.privateKey.slice(2)), false);
  }

  const decrypted = await decryptLaunchVaultBackup(result.encryptedBackup, passphrase);
  assert.deepEqual(decrypted, result.payload);
});
