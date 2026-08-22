import assert from "node:assert/strict";
import test from "node:test";

import {
  CANARY_BROADCAST_CONFIRMATION,
  parseCliCanaryArgs,
} from "../src/funded-canary";

test("parseCliCanaryArgs requires explicit broadcast confirmation phrase", () => {
  const opts = parseCliCanaryArgs([
    "--chain", "base",
    "--contract", "0x000000000000000000000000000000000000c0Fe",
    "--wallet", "hot=CANARY_WALLET",
    "--quantity", "1",
    "--max-total-eth", "0.06",
  ]);

  assert.equal(opts.chainKey, "base");
  assert.equal(opts.walletDescriptor, "hot=CANARY_WALLET");
  assert.equal(opts.quantity, 1);
  assert.equal(opts.maxTotalEth, 0.06);
  assert.equal(opts.broadcastConfirm, undefined);

  const broadcast = parseCliCanaryArgs([
    "--contract", "0x000000000000000000000000000000000000c0Fe",
    "--wallet", "hot=CANARY_WALLET_KEY",
    "--max-total-eth", "0.06",
    "--broadcast-confirm", CANARY_BROADCAST_CONFIRMATION,
  ]);

  assert.equal(broadcast.broadcastConfirm, CANARY_BROADCAST_CONFIRMATION);
});

test("parseCliCanaryArgs rejects ambiguous or unsafe canary inputs", () => {
  assert.throws(
    () => parseCliCanaryArgs([
      "--contract", "0x000000000000000000000000000000000000c0Fe",
      "--wallet", "hot=CANARY_WALLET",
      "--wallet", "backup=BACKUP_WALLET",
      "--max-total-eth", "0.06",
    ]),
    /exactly one --wallet/i
  );

  assert.throws(
    () => parseCliCanaryArgs([
      "--contract", "0x000000000000000000000000000000000000c0Fe",
      "--wallet", "hot=CANARY_WALLET",
      "--max-total-eth", "0.06",
      "--max-fee-gwei", "1",
      "--priority-fee-gwei", "2",
    ]),
    /priority fee cannot exceed max fee/i
  );

  assert.throws(
    () => parseCliCanaryArgs([
      "--contract", "not-an-address",
      "--wallet", "hot=CANARY_WALLET",
      "--max-total-eth", "0.06",
    ]),
    /invalid contract address/i
  );
});
