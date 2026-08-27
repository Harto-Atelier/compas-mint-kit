import assert from "node:assert/strict";
import test from "node:test";

import {
  blockscoutTxUrl,
  humanizeMintError,
  relayHealthLabel,
  relayHealthStatusFromPayload,
} from "./low-latency-human-ux";

test("humanizeMintError maps technical failures to holder-safe copy", () => {
  assert.deepEqual(humanizeMintError(new Error("quote expired because price changed")), {
    message: "Precio cambió — revisa de nuevo",
    returnToReview: true,
  });
  assert.deepEqual(humanizeMintError(new Error("insufficient funds for intrinsic transaction cost")), {
    message: "Sin fondos suficientes",
    returnToReview: true,
  });
  assert.deepEqual(humanizeMintError(new Error("user rejected request")), {
    message: "Firma cancelada — revisa antes de intentar otra vez",
    returnToReview: true,
  });
  assert.deepEqual(humanizeMintError(new Error("HTTP 504 from relay")), {
    message: "Vía rápida no disponible — puedes reintentar",
    returnToReview: false,
  });
});

test("relay health badge derives honest states from live health payload shape", () => {
  assert.equal(relayHealthStatusFromPayload({ ok: true, service: "compas-fast-relay", routes: 3 }), "active");
  assert.equal(relayHealthLabel("active"), "Vía rápida activa");
  assert.equal(relayHealthStatusFromPayload({ ok: true, service: "compas-fast-relay", routes: 2 }), "degraded");
  assert.equal(relayHealthLabel("degraded"), "Vía rápida degradada");
  assert.equal(relayHealthStatusFromPayload({ ok: true, service: "compas-fast-relay", routes: 0 }), "unavailable");
  assert.equal(relayHealthStatusFromPayload(null), "unavailable");
  assert.equal(relayHealthLabel("unavailable"), "No disponible");
});

test("blockscout receipt links use Robinhood Chain explorer", () => {
  const hash = `0x${"a".repeat(64)}`;
  assert.equal(blockscoutTxUrl(hash), `https://robinhoodchain.blockscout.com/tx/${hash}`);
});
