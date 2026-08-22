import test from "node:test";
import assert from "node:assert/strict";
import {
  createDemoWalletRecords,
  createImportedWalletRecords,
  normalizeWalletCount,
  parseBulkWalletImport,
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

test("demo wallets produce public-address records only", () => {
  const records = createDemoWalletRecords(2, 2000, () => "2".repeat(40));
  assert.equal(records.length, 2);
  assert.equal(records[0].source, "demo");
  assert.equal(records[0].secretStatus, "none");
  assert.match(records[0].address, /^0x[0-9a-f]{40}$/);
});
