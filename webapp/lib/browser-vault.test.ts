import assert from "node:assert/strict";
import test from "node:test";
import { createEncryptedVaultWallet, unlockEncryptedVaultWallet } from "./browser-vault";

const PRIVATE_KEY = "0x" + "1".repeat(64);
const PASSPHRASE = "correct horse vault battery";

test("encrypted vault wallet stores address-only metadata and unlocks with passphrase", async () => {
  const vault = await createEncryptedVaultWallet({ privateKey: PRIVATE_KEY, passphrase: PASSPHRASE, createdAt: new Date("2026-01-01T00:00:00.000Z") });

  assert.equal(vault.version, "compas.encrypted-vault-wallet.v1");
  assert.match(vault.address, /^0x[0-9A-Fa-f]{40}$/);
  assert.equal(vault.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(JSON.stringify(vault).includes(PRIVATE_KEY.slice(2)), false);
  assert.equal(JSON.stringify(vault).includes("privateKey"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(vault, "privateKey"), false);

  const unlocked = await unlockEncryptedVaultWallet(vault, PASSPHRASE);
  assert.equal(unlocked.address.toLowerCase(), vault.address.toLowerCase());
  assert.equal(unlocked.privateKey, PRIVATE_KEY);
});

test("encrypted vault wallet rejects short or wrong passphrases", async () => {
  await assert.rejects(
    () => createEncryptedVaultWallet({ privateKey: PRIVATE_KEY, passphrase: "too short" }),
    /at least 12/,
  );

  const vault = await createEncryptedVaultWallet({ privateKey: PRIVATE_KEY, passphrase: PASSPHRASE });
  await assert.rejects(
    () => unlockEncryptedVaultWallet(vault, "wrong horse vault battery"),
    /Unable to unlock vault wallet/,
  );
});
