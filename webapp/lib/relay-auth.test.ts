import assert from "node:assert/strict";
import test from "node:test";

import {
  createRelayAuthToken,
  issueRelayAuthToken,
  verifyRelayAuthToken,
  type RelayAuthPurpose,
} from "./relay-auth";

const SECRET = "test-relay-auth-secret-with-enough-entropy";
const HOLDER = "0xED346CEF754407662144336Fd2835d3600168d1f";
const NOW = 1_900_000_000_000;
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;
const PLAN_BINDING = `0x${"c".repeat(64)}`;

function token(overrides: Partial<Parameters<typeof issueRelayAuthToken>[0]> = {}) {
  return issueRelayAuthToken(
    {
      holderAddress: HOLDER,
      launchId: "compas-mainnet-2026",
      chainId: 1,
      maxTransactionCount: 2,
      purpose: "broadcast",
      expectedHashes: [HASH_A, HASH_B],
      planBinding: PLAN_BINDING,
      ttlMs: 60_000,
      ...overrides,
    },
    { now: NOW, secret: SECRET },
  );
}

test("relay token binds holder, launch, expiry, chain, max tx count, and purpose", () => {
  const issued = token();

  assert.equal(issued.holderAddress, HOLDER.toLowerCase());
  assert.equal(issued.launchId, "compas-mainnet-2026");
  assert.equal(issued.chainId, 1);
  assert.equal(issued.maxTransactionCount, 2);
  assert.equal(issued.purpose, "broadcast");
  assert.deepEqual(issued.expectedHashes, [HASH_A, HASH_B]);
  assert.equal(issued.planBinding, PLAN_BINDING);
  assert.equal(issued.expiresAt, NOW + 60_000);
  assert.match(issued.token, /^relay-hmac-v1\.[^.]+\.[^.]+$/);

  const verified = verifyRelayAuthToken(issued.token, {
    now: NOW + 1_000,
    secret: SECRET,
    expectedPurpose: "broadcast",
    expectedChainId: 1,
    transactionCount: 2,
    expectedHashes: [HASH_B, HASH_A],
    expectedPlanBinding: PLAN_BINDING,
    expectedHolderAddress: HOLDER,
    expectedLaunchId: "compas-mainnet-2026",
  });

  assert.equal(verified.ok, true);
  assert.equal(verified.ok ? verified.payload.holderAddress : "", HOLDER.toLowerCase());
});

test("relay token verification rejects expired tokens", () => {
  const issued = token({ ttlMs: 1_000 });

  const verified = verifyRelayAuthToken(issued.token, {
    now: NOW + 1_001,
    secret: SECRET,
    expectedPurpose: "broadcast",
    expectedChainId: 1,
    transactionCount: 1,
  });

  assert.deepEqual(verified, { ok: false, reason: "expired" });
});

test("relay token verification enforces chain binding", () => {
  const verified = verifyRelayAuthToken(token().token, {
    now: NOW,
    secret: SECRET,
    expectedPurpose: "broadcast",
    expectedChainId: 8453,
    transactionCount: 1,
  });

  assert.deepEqual(verified, { ok: false, reason: "chain-mismatch" });
});

test("relay token verification enforces max transaction count", () => {
  const verified = verifyRelayAuthToken(token({ maxTransactionCount: 1 }).token, {
    now: NOW,
    secret: SECRET,
    expectedPurpose: "broadcast",
    expectedChainId: 1,
    transactionCount: 2,
  });

  assert.deepEqual(verified, { ok: false, reason: "transaction-count-exceeded" });
});

test("relay token verification enforces purpose", () => {
  const purposes: RelayAuthPurpose[] = ["broadcast", "arm"];
  assert.deepEqual(purposes, ["broadcast", "arm"]);

  const verified = verifyRelayAuthToken(token({ purpose: "arm" }).token, {
    now: NOW,
    secret: SECRET,
    expectedPurpose: "broadcast",
    expectedChainId: 1,
    transactionCount: 1,
  });

  assert.deepEqual(verified, { ok: false, reason: "purpose-mismatch" });
});

test("relay token verification enforces exact expected hashes and plan binding", () => {
  assert.deepEqual(verifyRelayAuthToken(token().token, {
    now: NOW,
    secret: SECRET,
    expectedPurpose: "broadcast",
    expectedChainId: 1,
    transactionCount: 1,
    expectedHashes: [HASH_A],
  }), { ok: false, reason: "hash-mismatch" });

  assert.deepEqual(verifyRelayAuthToken(token().token, {
    now: NOW,
    secret: SECRET,
    expectedPurpose: "broadcast",
    expectedChainId: 1,
    transactionCount: 1,
    expectedHashes: [HASH_A, `0x${"d".repeat(64)}`],
  }), { ok: false, reason: "hash-mismatch" });

  assert.deepEqual(verifyRelayAuthToken(token().token, {
    now: NOW,
    secret: SECRET,
    expectedPurpose: "broadcast",
    expectedChainId: 1,
    transactionCount: 1,
    expectedPlanBinding: `0x${"e".repeat(64)}`,
  }), { ok: false, reason: "plan-binding-mismatch" });
});

test("relay token issuance reads only the server-side relay secret from env", () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.COMPAS_RELAY_AUTH_SECRET;
  try {
    env.COMPAS_RELAY_AUTH_SECRET = SECRET;
    const issued = issueRelayAuthToken({
      holderAddress: HOLDER,
      launchId: "compas-mainnet-2026",
      chainId: 1,
      maxTransactionCount: 1,
      purpose: "arm",
      expectedHashes: [HASH_A],
      planBinding: PLAN_BINDING,
    }, { now: NOW });
    assert.equal(issued.purpose, "arm");
    assert.equal(verifyRelayAuthToken(issued.token, {
      now: NOW,
      expectedPurpose: "arm",
      expectedChainId: 1,
      transactionCount: 0,
    }).ok, true);
  } finally {
    if (previous === undefined) delete env.COMPAS_RELAY_AUTH_SECRET; else env.COMPAS_RELAY_AUTH_SECRET = previous;
  }
});

test("relay token issuance and verification fail closed in production when the relay secret is absent", () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = { nodeEnv: env.NODE_ENV, relay: env.COMPAS_RELAY_AUTH_SECRET };
  try {
    env.NODE_ENV = "production";
    delete env.COMPAS_RELAY_AUTH_SECRET;

    assert.throws(
      () => createRelayAuthToken(
        {
          holderAddress: HOLDER,
          launchId: "compas-mainnet-2026",
          chainId: 1,
          maxTransactionCount: 1,
          purpose: "broadcast",
          expectedHashes: [HASH_A],
          planBinding: PLAN_BINDING,
        },
        NOW,
      ),
      /COMPAS_RELAY_AUTH_SECRET is required/i,
    );

    assert.deepEqual(verifyRelayAuthToken("relay-hmac-v1.fake.fake", {
      now: NOW,
      expectedPurpose: "broadcast",
      expectedChainId: 1,
      transactionCount: 1,
    }), { ok: false, reason: "secret-missing" });
  } finally {
    if (previous.nodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = previous.nodeEnv;
    if (previous.relay === undefined) delete env.COMPAS_RELAY_AUTH_SECRET; else env.COMPAS_RELAY_AUTH_SECRET = previous.relay;
  }
});
