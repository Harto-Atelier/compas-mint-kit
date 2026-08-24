import assert from "node:assert/strict";
import test from "node:test";

import { fetchHolderPositions, normalizeInstanceTokenIds } from "./holder-positions";

const WALLET = "0x68A24AB6dC7e2F8deDD2993Eb178A68e0B7473d4";
const CONTRACT = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D";

test("normalizeInstanceTokenIds dedupes and stringifies ids from real Blockscout item shape", () => {
  // Shape observed live on eth.blockscout.com /api/v2/tokens/{contract}/instances
  const items = [
    { id: "9977", token_type: "ERC-721", value: "1" },
    { id: "9977", token_type: "ERC-721", value: "1" }, // duplicate
    { id: 6083, token_type: "ERC-721", value: "1" }, // numeric id must stringify
    { id: null, token_type: "ERC-721", value: "1" }, // no id -> dropped, never invented
    { token_type: "ERC-721" },
    { id: "  42  " },
  ];
  assert.deepEqual(normalizeInstanceTokenIds(items), ["9977", "6083", "42"]);
});

test("normalizeInstanceTokenIds returns empty array for empty input", () => {
  assert.deepEqual(normalizeInstanceTokenIds([]), []);
});

test("invalid wallet returns error and no tokenIds", async () => {
  const result = await fetchHolderPositions({ wallet: "0x123", contract: CONTRACT, chain: "ethereum" });
  assert.equal(result.error, "invalid wallet address");
  assert.deepEqual(result.tokenIds, []);
  assert.equal(result.schemaVersion, "compas-holder-positions.v1");
});

test("invalid contract returns error and no tokenIds", async () => {
  const result = await fetchHolderPositions({ wallet: WALLET, contract: "not-an-address", chain: "ethereum" });
  assert.equal(result.error, "invalid contract address");
  assert.deepEqual(result.tokenIds, []);
});

test("unsupported chain returns error and no tokenIds", async () => {
  const result = await fetchHolderPositions({ wallet: WALLET, contract: CONTRACT, chain: "dogechain" });
  assert.equal(result.error, "unsupported chain dogechain");
  assert.deepEqual(result.tokenIds, []);
});

test("HTTP 503 from injected fetchImpl returns blockscout-http-503", async () => {
  const fetchImpl = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
  const result = await fetchHolderPositions({ wallet: WALLET, contract: CONTRACT, chain: "ethereum", fetchImpl });
  assert.equal(result.error, "blockscout-http-503");
  assert.deepEqual(result.tokenIds, []);
  assert.equal(result.sampleTruncated, false);
});

test("single page response collects deduped tokenIds without truncation flag", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        items: [
          { id: "1", token_type: "ERC-721", value: "1" },
          { id: "2", token_type: "ERC-721", value: "1" },
          { id: "2", token_type: "ERC-721", value: "1" },
        ],
        next_page_params: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  const result = await fetchHolderPositions({ wallet: WALLET, contract: CONTRACT, chain: "ethereum", fetchImpl });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.tokenIds, ["1", "2"]);
  assert.equal(result.sampleTruncated, false);
});
