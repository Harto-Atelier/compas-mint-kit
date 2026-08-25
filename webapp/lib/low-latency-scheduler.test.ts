import assert from "node:assert/strict";
import test from "node:test";

import { scheduleLowLatencyBroadcasts, type LowLatencyPreparedEnvelope } from "./low-latency-scheduler";

function burnerAddress(index: number): string {
  return `0x${(index + 1).toString(16).padStart(40, "0")}`;
}

function envelope(id: string, from: string, nonce: number): LowLatencyPreparedEnvelope {
  return { id, from, nonce, signedTransaction: `0x${id.padEnd(64, "0")}` };
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

test("scheduleLowLatencyBroadcasts starts 50 independent burner envelopes concurrently up to the configured limit", async () => {
  const rows = Array.from({ length: 50 }, (_, index) => envelope(`burner-${index}`, burnerAddress(index), 0));
  const started: string[] = [];
  let active = 0;
  let maxActive = 0;
  let releaseCurrentBatch = () => {};
  let currentBatchReleased = new Promise<void>((resolve) => {
    releaseCurrentBatch = resolve;
  });

  const scheduled = scheduleLowLatencyBroadcasts(rows, {
    concurrency: 7,
    broadcast: async (row) => {
      started.push(row.id);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await currentBatchReleased;
      active -= 1;
      return { hash: `hash-${row.id}` };
    },
  });

  await waitFor(() => started.length === 7, "first concurrency batch");
  assert.deepEqual(started, rows.slice(0, 7).map((row) => row.id));
  assert.equal(active, 7);

  while (started.length < rows.length) {
    const releasePreviousBatch = releaseCurrentBatch;
    currentBatchReleased = new Promise<void>((resolve) => {
      releaseCurrentBatch = resolve;
    });
    releasePreviousBatch();
    await waitFor(() => active === 7 || started.length === rows.length, "next concurrency batch");
  }
  releaseCurrentBatch();

  const results = await scheduled;
  assert.equal(maxActive, 7);
  assert.equal(results.length, 50);
  assert.equal(results.every((result) => result.status === "fulfilled"), true);
  assert.deepEqual(
    results.map((result) => result.row.id),
    rows.map((row) => row.id),
    "results stay aligned to the original rows",
  );
});

test("scheduleLowLatencyBroadcasts preserves same-address nonce order while unrelated addresses continue", async () => {
  const shared = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const rows = [
    envelope("shared-nonce-2", shared, 2),
    envelope("independent", burnerAddress(20), 0),
    envelope("shared-nonce-0", shared, 0),
    envelope("shared-nonce-1", shared, 1),
  ];
  const startOrder: string[] = [];
  const finishById = new Map<string, () => void>();

  const scheduled = scheduleLowLatencyBroadcasts(rows, {
    concurrency: 3,
    broadcast: async (row) => {
      startOrder.push(row.id);
      await new Promise<void>((resolve) => finishById.set(row.id, resolve));
      return { hash: `hash-${row.id}` };
    },
  });

  await waitFor(() => startOrder.length === 2, "initial dependency-aware starts");
  assert.deepEqual(startOrder, ["independent", "shared-nonce-0"]);
  assert.equal(finishById.has("shared-nonce-1"), false);
  assert.equal(finishById.has("shared-nonce-2"), false);

  finishById.get("independent")?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(startOrder.includes("shared-nonce-1"), false, "later nonce must wait for earlier same-address nonce, not global capacity");

  finishById.get("shared-nonce-0")?.();
  await waitFor(() => startOrder.includes("shared-nonce-1"), "nonce 1 start");
  finishById.get("shared-nonce-1")?.();
  await waitFor(() => startOrder.includes("shared-nonce-2"), "nonce 2 start");
  finishById.get("shared-nonce-2")?.();

  const results = await scheduled;
  assert.deepEqual(startOrder, ["independent", "shared-nonce-0", "shared-nonce-1", "shared-nonce-2"]);
  assert.deepEqual(
    results.map((result) => result.row.id),
    rows.map((row) => row.id),
    "scheduler returns row results in input order even when nonce execution order differs",
  );
});

test("scheduleLowLatencyBroadcasts accepts browser signed-envelope fields without collection-specific rules", async () => {
  const rows = [
    { id: "browser-1", walletAddress: burnerAddress(30), request: { nonce: "0x0" }, signedTransaction: "0xabc" },
    { id: "browser-2", walletAddress: burnerAddress(31), request: { nonce: "0x0" }, signedTransaction: "0xdef" },
  ];

  const results = await scheduleLowLatencyBroadcasts(rows, {
    concurrency: 2,
    broadcast: async (row) => ({ hash: `hash-${row.id}` }),
  });

  assert.equal(results.every((result) => result.status === "fulfilled"), true);
  assert.deepEqual(
    results.map((result) => {
      assert.equal(result.status, "fulfilled");
      return result.value;
    }),
    [{ hash: "hash-browser-1" }, { hash: "hash-browser-2" }],
  );
});

test("scheduleLowLatencyBroadcasts rejects more than 50 envelopes", async () => {
  const rows = Array.from({ length: 51 }, (_, index) => envelope(`burner-${index}`, burnerAddress(index), 0));

  await assert.rejects(
    () => scheduleLowLatencyBroadcasts(rows, { concurrency: 10, broadcast: async () => ({ hash: "hash" }) }),
    /at most 50/i,
  );
});
