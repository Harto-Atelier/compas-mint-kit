import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { BurnerGenerationPanel, ImportWalletPanel, RecoveryFilePanel, RestoreBackupPanel } from "../app/LaunchVaultConsole";
import {
  MAX_LAUNCH_VAULT_BACKUP_BYTES,
  assertLaunchVaultBackupFileSize,
  parseLaunchVaultBackupRestore,
  type AuthenticatedLaunchVaultRestore,
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

function restorePanel(overrides: Partial<Parameters<typeof RestoreBackupPanel>[0]> = {}) {
  return RestoreBackupPanel({
    authenticatedRestore: null,
    fileInputKey: 0,
    hasVault: true,
    replaceConfirmation: "",
    restoreFileName: null,
    restoreCurrentPassphrase: "",
    restorePassphrase: "",
    restoreText: "",
    onAuthenticate: noop,
    onCommit: noop,
    onFile: noop,
    onReplaceConfirmation: noop,
    onRestoreCurrentPassphrase: noop,
    onRestorePassphrase: noop,
    onRestoreText: noop,
    ...overrides,
  });
}

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

test("Vault burner controls initialize from the shared Base default and retain Ethereum", () => {
  assert.match(consoleSource, /useState<LaunchVaultChain>\(DEFAULT_BURNER_CHAIN\)/);
  assert.match(consoleSource, /const CHAINS: LaunchVaultChain\[\] = \["Base", "ETH"\]/);
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

test("restore first requires local candidate authentication and does not show replacement controls early", () => {
  const markup = renderToStaticMarkup(restorePanel());

  assert.match(markup, /^<details/);
  assert.match(markup, /Restore from file/);
  assert.match(markup, /type="file"/);
  assert.match(markup, /accept="application\/json,.json,.compas-vault"/);
  assert.match(markup, /Encrypted backup JSON/);
  assert.match(markup, /Candidate passphrase/);
  assert.match(markup, /Authenticate backup locally/);
  assert.doesNotMatch(markup, /Type REPLACE/);
  assert.doesNotMatch(markup, /Private key/);
});

test("authenticated restore shows a public-only candidate summary before candidate-specific replacement", () => {
  const backup = parseLaunchVaultBackupRestore(validEncryptedBackup);
  const authenticatedRestore: AuthenticatedLaunchVaultRestore = {
    backup,
    canonicalSerialized: `${JSON.stringify(backup, null, 2)}\n`,
    storageSnapshot: "existing bytes",
    replacesExisting: true,
    summary: {
      launchId: "launch-candidate",
      launchName: "Candidate launch",
      walletCount: 2,
      maskedAddresses: ["0x1234…abcd", "0xabcd…1234"],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
    },
  };
  const markup = renderToStaticMarkup(restorePanel({ authenticatedRestore }));

  assert.match(markup, /Authenticated backup summary/);
  assert.match(markup, /Candidate launch/);
  assert.match(markup, /launch-candidate/);
  assert.match(markup, /2 wallets/);
  assert.match(markup, /0x1234…abcd/);
  assert.match(markup, /Created/);
  assert.match(markup, /Updated/);
  assert.match(markup, /Type REPLACE launch-candidate/);
  assert.match(markup, /Replace with authenticated backup/);
  assert.doesNotMatch(markup, /Candidate passphrase/);
});

test("restore parsing validates encrypted envelopes, canonicalizes, and rejects malformed or oversized input", () => {
  assert.equal(parseLaunchVaultBackupRestore(validEncryptedBackup).kind, "compas-launch-vault");
  assert.throws(() => parseLaunchVaultBackupRestore("{bad-json"));
  assert.throws(() => parseLaunchVaultBackupRestore(JSON.stringify({ kind: "plaintext", privateKey: "0xsecret" })));
  assert.throws(() => parseLaunchVaultBackupRestore(" ".repeat(MAX_LAUNCH_VAULT_BACKUP_BYTES + 1)), /too large/i);
  assert.throws(() => assertLaunchVaultBackupFileSize(MAX_LAUNCH_VAULT_BACKUP_BYTES + 1), /too large/i);
});

test("restore orchestration canonicalizes pasted JSON before authentication, clears passphrases, and writes only through the transactional commit", () => {
  assert.match(consoleSource, /const validatedBackup = parseLaunchVaultBackupRestore\(raw\)/);
  assert.match(consoleSource, /setRestoreText\(serializeEncryptedLaunchVaultBackup\(validatedBackup\)\)/);
  assert.doesNotMatch(consoleSource, /setRestoreText\(raw\)/);
  assert.match(consoleSource, /handleAuthenticateRestore[\s\S]{0,700}const canonicalCandidate = serializeEncryptedLaunchVaultBackup\(parseLaunchVaultBackupRestore\(restoreText\)\)[\s\S]{0,200}setRestoreText\(canonicalCandidate\)/);
  assert.match(consoleSource, /authenticateLaunchVaultBackupRestore\(/);
  assert.match(consoleSource, /raw: canonicalCandidate/);
  assert.match(consoleSource, /candidatePassphrase: restorePassphrase/);
  assert.match(consoleSource, /setRestorePassphrase\(""\)/);
  assert.match(consoleSource, /commitAuthenticatedLaunchVaultRestore\(/);
  assert.match(consoleSource, /storage: window\.localStorage/);
  assert.doesNotMatch(consoleSource, /persistBackup\(restoredBackup\)/);
  assert.doesNotMatch(restoreSource, /console\.|fetch\s*\(/);
  assert.doesNotMatch(consoleSource, /fetch\s*\(/);
});

test("restore transient state is cleared after success, lock, and wipe", () => {
  assert.equal((consoleSource.match(/clearRestoreTransientState\(\)/g) ?? []).length >= 3, true);
  assert.match(consoleSource, /setUnlockPassphrase\(""\)/);
  assert.match(consoleSource, /setRestorePassphrase\(""\)/);
  assert.match(consoleSource, /setAuthenticatedRestore\(null\)/);
  assert.match(consoleSource, /removeLaunchVaultStorage\([\s\S]{0,900}setCreatePassphrase\(""\)[\s\S]{0,200}setCreateConfirm\(""\)/);
});

test("Vault console uses canonical lifecycle writes and generation cancellation for stale file/auth completions", () => {
  assert.match(consoleSource, /writeLaunchVaultStorage/);
  assert.match(consoleSource, /removeLaunchVaultStorage/);
  assert.match(consoleSource, /subscribeToLaunchVaultLifecycle/);
  assert.match(consoleSource, /createLaunchVaultGenerationGuard/);
  assert.match(consoleSource, /restoreFileGeneration/);
  assert.match(consoleSource, /restoreAuthGeneration/);
  assert.doesNotMatch(consoleSource, /window\.localStorage\.(?:setItem|removeItem)\(LAUNCH_VAULT_STORAGE_KEY/);
});

test("Recovery file panel renders download button and persistent saved-file confirmation", () => {
  const markup = renderToStaticMarkup(
    RecoveryFilePanel({ confirmed: false, hasVault: true, onConfirm: noop, onDownload: noop }),
  );

  assert.match(markup, /Download recovery file/);
  assert.match(markup, /\.compas-vault/);
  assert.match(markup, /I saved my recovery file/);
  assert.match(markup, /type="checkbox"/);
  assert.doesNotMatch(markup, /Private key/);
});

test("Recovery file panel disables actions without a vault and reflects the confirmed flag", () => {
  const emptyMarkup = renderToStaticMarkup(
    RecoveryFilePanel({ confirmed: false, hasVault: false, onConfirm: noop, onDownload: noop }),
  );
  assert.match(emptyMarkup, /disabled=""/);

  const confirmedMarkup = renderToStaticMarkup(
    RecoveryFilePanel({ confirmed: true, hasVault: true, onConfirm: noop, onDownload: noop }),
  );
  assert.match(confirmedMarkup, /checked=""/);
});
