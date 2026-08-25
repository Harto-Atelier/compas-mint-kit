import assert from "node:assert/strict";
import test from "node:test";

import { Wallet } from "ethers";

import {
  buildCompasChallenge,
  createNonceToken,
  decodeSignedPayload,
  encodeSessionCookie,
  readNonce,
  readSessionCookie,
  verifyCompasSignature,
} from "./compas-auth";

test("signed nonce tokens validate, expire, and reject tampering", () => {
  const now = 1_800_000;
  const { token, nonce } = createNonceToken(now);
  assert.equal(readNonce(token, now + 1_000)?.nonce, nonce);
  assert.equal(readNonce(token, now + 11 * 60 * 1_000), null);
  assert.equal(readNonce(`${token}x`, now), null);
  assert.equal(decodeSignedPayload("not.a.token"), null);
});

test("wallet signature must match the server challenge address and nonce", async () => {
  const wallet = Wallet.createRandom();
  const nonce = "abc123";
  const message = buildCompasChallenge(wallet.address, nonce);
  const signature = await wallet.signMessage(message);
  assert.equal(verifyCompasSignature(wallet.address, nonce, signature), true);
  assert.equal(verifyCompasSignature(wallet.address, "other-nonce", signature), false);
  assert.equal(verifyCompasSignature("0x0000000000000000000000000000000000000001", nonce, signature), false);
  assert.equal(verifyCompasSignature(wallet.address, nonce, "0xdead"), false);
});

test("session cookie validates holder fields and expiry", () => {
  const now = 2_000_000;
  const token = encodeSessionCookie({
    address: "0xED346CEF754407662144336Fd2835d3600168d1f",
    compasCount: 2,
    verifiedAt: now,
    expiresAt: now + 1_000,
  });
  assert.equal(readSessionCookie(token, now + 500)?.compasCount, 2);
  assert.equal(readSessionCookie(token, now + 1_500), null);
  assert.equal(readSessionCookie(`${token}x`, now), null);
});

test("production authentication fails closed when no signing secret is configured", () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = {
    nodeEnv: env.NODE_ENV,
    compas: env.COMPAS_GATE_SECRET,
    nextauth: env.NEXTAUTH_SECRET,
    auth: env.AUTH_SECRET,
  };
  try {
    env.NODE_ENV = "production";
    delete env.COMPAS_GATE_SECRET;
    delete env.NEXTAUTH_SECRET;
    delete env.AUTH_SECRET;
    assert.throws(() => createNonceToken(1), /COMPAS_GATE_SECRET is required in production/i);
    assert.equal(decodeSignedPayload("Zm9yZ2Vk.Zm9yZ2Vk"), null);
  } finally {
    if (previous.nodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = previous.nodeEnv;
    if (previous.compas === undefined) delete env.COMPAS_GATE_SECRET; else env.COMPAS_GATE_SECRET = previous.compas;
    if (previous.nextauth === undefined) delete env.NEXTAUTH_SECRET; else env.NEXTAUTH_SECRET = previous.nextauth;
    if (previous.auth === undefined) delete env.AUTH_SECRET; else env.AUTH_SECRET = previous.auth;
  }
});
