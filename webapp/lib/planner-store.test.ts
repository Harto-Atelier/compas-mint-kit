import test from "node:test";
import assert from "node:assert/strict";
import {
  createImportedWalletRecords,
  createInitialPlannerState,
  confirmWipeLaunchKeys,
  normalizeWalletCount,
  parseBulkWalletImport,
  rotatePlannerLaunch,
  sanitizeStageQuantity,
  shortenWalletAddress,
} from "./planner-store";

test("bulk import keeps public wallet fields and discards secret-like columns", () => {
  const drafts = parseBulkWalletImport(
    "Mint ops, 0x1111111111111111111111111111111111111111, 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0\ninvalid, nope",
    "Base",
  );
  assert.deepEqual(drafts, [
    {
      name: "Mint ops",
      address: "0x1111111111111111111111111111111111111111",
      chain: "Base",
    },
  ]);

  const records = createImportedWalletRecords(drafts, 1000);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, "Mint ops");
  assert.equal(records[0].secretStatus, "discarded");
  assert.equal(records[0].source, "imported");
  assert.equal(Object.prototype.hasOwnProperty.call(records[0], "privateKey"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(records[0], "secret"), false);
  assert.equal(JSON.stringify(records).includes("f".repeat(63) + "0"), false);
});

test("bulk import does not promote key material into wallet names", () => {
  const privateKey = "0x" + "a".repeat(64);
  const rawTx = "0x02" + "b".repeat(200);
  const drafts = parseBulkWalletImport(
    `${privateKey}, ${rawTx}, 0x2222222222222222222222222222222222222222`,
    "ETH",
  );

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].name, "Imported wallet 1");
  assert.equal(JSON.stringify(drafts).includes(privateKey.slice(2)), false);
  assert.equal(JSON.stringify(drafts).includes(rawTx.slice(2)), false);
});

test("wallet helpers clamp planner counts and mask addresses", () => {
  assert.equal(normalizeWalletCount(99, 3), 3);
  assert.equal(normalizeWalletCount(0, 3), 1);
  assert.equal(sanitizeStageQuantity(1000), 100);
  assert.equal(shortenWalletAddress("0x1111111111111111111111111111111111111111"), "0x1111…1111");
});

test("initial planner state starts empty with no placeholder wallets", () => {
  const state = createInitialPlannerState(1000);
  assert.equal(state.wallets.length, 0);
  assert.equal(state.walletCount, 0);
  assert.equal(state.launchVaults.length, 1);
  assert.equal(state.launchVaults[0].walletCount, 0);
  assert.equal(JSON.stringify(state.wallets).includes("demo"), false);
});

test("rotation archives the previous launch and creates a new empty encrypted vault", () => {
  const state = createInitialPlannerState(1000);
  const rotated = rotatePlannerLaunch(state, {
    createdAt: 2000,
    launchId: "launch-next",
    vaultId: "vault-next",
    previousVaultMode: "archive",
  });

  assert.equal(rotated.activeLaunchId, "launch-next");
  assert.equal(rotated.wallets.length, 0);
  assert.equal(rotated.walletCount, 0);
  assert.equal(rotated.launchVaults.length, 2);
  assert.deepEqual(rotated.launchVaults.map((vault) => vault.status), ["archived", "active"]);
  assert.equal(rotated.launchVaults[1].launchId, "launch-next");
  assert.equal(rotated.launchVaults[1].vaultId, "vault-next");
  assert.equal(rotated.launchVaults[1].rotatedFrom, state.activeLaunchId);
  assert.equal(rotated.launchVaults[1].walletCount, 0);
  assert.match(rotated.launchVaults[1].encryptedVault, /^encrypted-empty-vault:v1:/);
});

test("rotation can delete the previous launch vault instead of archiving", () => {
  const state = createInitialPlannerState(1000);
  const rotated = rotatePlannerLaunch(state, {
    createdAt: 2000,
    launchId: "launch-delete-mode",
    vaultId: "vault-delete-mode",
    previousVaultMode: "delete",
  });

  assert.equal(rotated.launchVaults.length, 1);
  assert.equal(rotated.launchVaults[0].launchId, "launch-delete-mode");
  assert.equal(rotated.launchVaults[0].rotatedFrom, state.activeLaunchId);
});

test("wipe requires exact confirmation and destroys archived launch key metadata", () => {
  const state = rotatePlannerLaunch(createInitialPlannerState(1000), {
    createdAt: 2000,
    launchId: "launch-next",
    vaultId: "vault-next",
    previousVaultMode: "archive",
  });
  const oldLaunchId = state.launchVaults[0].launchId;

  assert.throws(() => confirmWipeLaunchKeys(state, oldLaunchId, "wrong", 3000), /type the launch id/i);

  const wiped = confirmWipeLaunchKeys(state, oldLaunchId, oldLaunchId, 3000);
  const oldVault = wiped.launchVaults.find((vault) => vault.launchId === oldLaunchId);
  assert.ok(oldVault);
  assert.equal(oldVault.status, "wiped");
  assert.equal(oldVault.walletCount, 0);
  assert.equal(oldVault.wipedAt, 3000);
  assert.match(oldVault.encryptedVault, /^wiped-vault:v1:/);
  assert.equal(JSON.stringify(oldVault).includes("0x"), false);
  assert.equal(wiped.activeLaunchId, "launch-next");
});
