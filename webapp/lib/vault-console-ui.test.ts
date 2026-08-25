import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { BurnerGenerationPanel, ImportWalletPanel, RestoreBackupPanel } from "../app/LaunchVaultConsole";
import {
  MAX_LAUNCH_VAULT_BACKUP_BYTES,
  RESTORE_REPLACE_CONFIRMATION,
  assertLaunchVaultBackupFileSize,
  parseLaunchVaultBackupRestore,
  prepareLaunchVaultBackupRestore,
} from "./launch-vault-backup-restore";

const noop = () => undefined;
const consoleSource = readFileSync(new URL("../app/LaunchVaultConsole.tsx", import.meta.url), "utf8");
const restoreSource = readFileSync(new URL("./launch-vault-backup-restore.ts", import.meta.url), "utf8");
const validEncryptedBackup = JSON.stringify({
  kind: "compas-launch-vault",
  header: {
    version: 1,
    cipher: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: 250_000,
    salt: "AAAAAAAAAAAAAAAAAAAAAA==",
    iv: "AAAAAAAAAAAAAAAA",
    createdAt: 1,
    updatedAt: 1,
  },
  ciphertext: "AAAAAAAAAAAAAAAAAAAAAAA=",
});

test("Vault renders bounded burner generation as the primary local key path", () => {
  const markup = renderToStaticMarkup(
    BurnerGenerationPanel({
      count: "5",
      chain: "ETH",
      sealPassphrase: "",
      onCount: noop,
      onChain: noop,
      onSealPassphrase: noop,
      onSubmit: noop,
    }),
  );

  assert.match(markup, /Generate encrypted burners/);
  assert.match(markup, /Browser-local only/);
  assert.match(markup, /type="number"/);
  assert.match(markup, /min="1"/);
  assert.match(markup, /max="50"/);
  assert.match(markup, /Generate \+ encrypt burners/);
  assert.doesNotMatch(markup, /Private keys \(one per line\)/);
});

test("existing private-key import remains inside Advanced", () => {
  const markup = renderToStaticMarkup(
    ImportWalletPanel({
      bulkMode: false,
      chain: "ETH",
      label: "Launch wallet",
      privateKeyInput: "",
      sealPassphrase: "",
      onBulkMode: noop,
      onChain: noop,
      onLabel: noop,
      onPrivateKeyInput: noop,
      onSealPassphrase: noop,
      onSubmit: noop,
    }),
  );

  assert.match(markup, /^<details/);
  assert.match(markup, /Advanced · import private keys/);
  assert.match(markup, /Private key/);
});

test("encrypted backup restore is an Advanced client-only file or JSON workflow", () => {
  const markup = renderToStaticMarkup(
    RestoreBackupPanel({
      fileInputKey: 0,
      hasVault: true,
      replaceConfirmation: "",
      restoreFileName: null,
      restoreText: "",
      onFile: noop,
      onReplaceConfirmation: noop,
      onRestoreText: noop,
      onSubmit: noop,
    }),
  );

  assert.match(markup, /^<details/);
  assert.match(markup, /Advanced · restore encrypted backup/);
  assert.match(markup, /type="file"/);
  assert.match(markup, /accept="application\/json,.json"/);
  assert.match(markup, /Encrypted backup JSON/);
  assert.match(markup, /Type REPLACE VAULT/);
  assert.doesNotMatch(markup, /Passphrase/);
  assert.doesNotMatch(markup, /Private key/);
});

test("restore parsing validates encrypted envelopes and rejects malformed or oversized input", () => {
  assert.equal(parseLaunchVaultBackupRestore(validEncryptedBackup).kind, "compas-launch-vault");
  assert.throws(() => parseLaunchVaultBackupRestore("{bad-json"));
  assert.throws(() => parseLaunchVaultBackupRestore(JSON.stringify({ kind: "plaintext", privateKey: "0xsecret" })));
  assert.throws(() => parseLaunchVaultBackupRestore(" ".repeat(MAX_LAUNCH_VAULT_BACKUP_BYTES + 1)), /too large/i);
  assert.throws(() => assertLaunchVaultBackupFileSize(MAX_LAUNCH_VAULT_BACKUP_BYTES + 1), /too large/i);
});

test("restore strips every non-envelope field and requires exact confirmation before replacement", () => {
  const withInjectedPlaintext = JSON.stringify({
    ...JSON.parse(validEncryptedBackup),
    plaintext: { privateKey: "0xsecret" },
    passphrase: "do-not-store",
  });

  const sanitized = parseLaunchVaultBackupRestore(withInjectedPlaintext);
  assert.equal(JSON.stringify(sanitized).includes("plaintext"), false);
  assert.equal(JSON.stringify(sanitized).includes("privateKey"), false);
  assert.equal(JSON.stringify(sanitized).includes("passphrase"), false);
  assert.throws(
    () => prepareLaunchVaultBackupRestore(withInjectedPlaintext, true, "replace vault"),
    /REPLACE VAULT/,
  );
  assert.equal(
    prepareLaunchVaultBackupRestore(withInjectedPlaintext, true, RESTORE_REPLACE_CONFIRMATION).ciphertext,
    sanitized.ciphertext,
  );
});

test("restore stores only the validated encrypted envelope and never decrypts, fetches, or logs", () => {
  assert.match(consoleSource, /const validatedBackup = parseLaunchVaultBackupRestore\(raw\)/);
  assert.match(consoleSource, /setRestoreText\(serializeEncryptedLaunchVaultBackup\(validatedBackup\)\)/);
  assert.doesNotMatch(consoleSource, /setRestoreText\(raw\)/);
  assert.match(consoleSource, /const hasStoredBackup = window\.localStorage\.getItem\(LAUNCH_VAULT_STORAGE_KEY\) !== null/);
  assert.match(consoleSource, /prepareLaunchVaultBackupRestore\(restoreText, hasStoredBackup, replaceConfirmation\)/);
  assert.match(consoleSource, /hasVault=\{storageOccupied\}/);
  assert.match(consoleSource, /persistBackup\(restoredBackup\)/);
  assert.match(restoreSource, /confirmation !== RESTORE_REPLACE_CONFIRMATION/);
  assert.doesNotMatch(restoreSource, /decryptLaunchVaultBackup|privateKey|console\.|fetch\s*\(/);
  assert.doesNotMatch(consoleSource, /fetch\s*\(/);
});

test("restore transient state is cleared after success, lock, and wipe", () => {
  assert.equal((consoleSource.match(/clearRestoreTransientState\(\)/g) ?? []).length >= 3, true);
  assert.match(consoleSource, /setUnlockPassphrase\(""\)/);
  assert.match(consoleSource, /setError\(null\)/);
  assert.match(consoleSource, /window\.localStorage\.removeItem\(LAUNCH_VAULT_STORAGE_KEY\)[\s\S]{0,700}setCreatePassphrase\(""\)[\s\S]{0,200}setCreateConfirm\(""\)/);
});
