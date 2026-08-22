import assert from "node:assert/strict";
import test from "node:test";

import {
  balanceOfCalldata,
  isEthAddress,
  parseBalanceResult,
  parseGateSession,
  serializeGateSession,
} from "./compas-gate";

test("balanceOfCalldata encodes the padded balanceOf selector", () => {
  const data = balanceOfCalldata("0xED346CEF754407662144336Fd2835d3600168d1f");
  assert.equal(data, "0x70a08231000000000000000000000000ed346cef754407662144336fd2835d3600168d1f");
  assert.throws(() => balanceOfCalldata("not-an-address"));
});

test("parseBalanceResult handles hex results and garbage", () => {
  assert.equal(parseBalanceResult("0x0000000000000000000000000000000000000000000000000000000000000003"), 3);
  assert.equal(parseBalanceResult("0x0"), 0);
  assert.equal(parseBalanceResult(undefined), 0);
  assert.equal(parseBalanceResult("garbage"), 0);
});

test("gate session round-trips and rejects invalid or expired payloads", () => {
  const session = {
    address: "0xED346CEF754407662144336Fd2835d3600168d1f",
    compasCount: 2,
    verifiedAt: Date.now(),
  };
  assert.deepEqual(parseGateSession(serializeGateSession(session)), session);
  assert.equal(parseGateSession(null), null);
  assert.equal(parseGateSession("{"), null);
  assert.equal(parseGateSession(JSON.stringify({ ...session, compasCount: 0 })), null);
  assert.equal(parseGateSession(JSON.stringify({ ...session, verifiedAt: Date.now() - 48 * 60 * 60 * 1000 })), null);
});

test("isEthAddress validates shape only", () => {
  assert.equal(isEthAddress("0xED346CEF754407662144336Fd2835d3600168d1f"), true);
  assert.equal(isEthAddress("0x123"), false);
});
