import assert from "node:assert/strict";
import test from "node:test";

import { LAUNCH_VAULT_STORAGE_KEY } from "./encrypted-launch-vault";
import {
  LAUNCH_VAULT_LIFECYCLE_EVENT,
  createLaunchVaultGenerationGuard,
  removeLaunchVaultStorage,
  subscribeToLaunchVaultLifecycle,
  writeLaunchVaultStorage,
} from "./launch-vault-lifecycle";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    get value() { return value; },
    storage: {
      getItem: (key: string) => key === LAUNCH_VAULT_STORAGE_KEY ? value : null,
      setItem: (key: string, next: string) => { if (key === LAUNCH_VAULT_STORAGE_KEY) value = next; },
      removeItem: (key: string) => { if (key === LAUNCH_VAULT_STORAGE_KEY) value = null; },
    },
  };
}

test("all canonical Vault writes and wipes dispatch a same-document lifecycle event after storage changes", () => {
  const target = new EventTarget();
  const store = memoryStorage();
  const seen: Array<{ action: string; newValue: string | null; stored: string | null }> = [];
  target.addEventListener(LAUNCH_VAULT_LIFECYCLE_EVENT, (event) => {
    const detail = (event as Event & { detail: { action: string; newValue: string | null } }).detail;
    seen.push({ action: detail.action, newValue: detail.newValue, stored: store.value });
  });

  for (const action of ["persist", "reseal", "restore", "rotation"] as const) {
    writeLaunchVaultStorage({ storage: store.storage, eventTarget: target, sourceId: "vault-console", action, serialized: action });
  }
  removeLaunchVaultStorage({ storage: store.storage, eventTarget: target, sourceId: "vault-console", action: "wipe" });

  assert.deepEqual(seen, [
    { action: "persist", newValue: "persist", stored: "persist" },
    { action: "reseal", newValue: "reseal", stored: "reseal" },
    { action: "restore", newValue: "restore", stored: "restore" },
    { action: "rotation", newValue: "rotation", stored: "rotation" },
    { action: "wipe", newValue: null, stored: null },
  ]);
});

test("lifecycle subscription accepts only the Vault key from storage or canonical same-document events", () => {
  const target = new EventTarget();
  const store = memoryStorage("current");
  const values: Array<string | null> = [];
  const unsubscribe = subscribeToLaunchVaultLifecycle(target, (change) => values.push(change.newValue), { ignoreSourceId: "self" });

  const unrelated = new Event("storage") as Event & { key?: string; newValue?: string | null };
  unrelated.key = "other-key";
  unrelated.newValue = "ignore";
  target.dispatchEvent(unrelated);
  writeLaunchVaultStorage({ storage: store.storage, eventTarget: target, sourceId: "self", action: "persist", serialized: "self" });
  writeLaunchVaultStorage({ storage: store.storage, eventTarget: target, sourceId: "other", action: "reseal", serialized: "same-document" });
  const crossTab = new Event("storage") as Event & { key?: string; newValue?: string | null };
  crossTab.key = LAUNCH_VAULT_STORAGE_KEY;
  crossTab.newValue = "cross-tab";
  target.dispatchEvent(crossTab);
  unsubscribe();

  assert.deepEqual(values, ["same-document", "cross-tab"]);
});

test("generation guards make stale async completions unusable after lock, wipe, or a new candidate", () => {
  const guard = createLaunchVaultGenerationGuard();
  const first = guard.begin();
  assert.equal(guard.isCurrent(first), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(first), false);
  const second = guard.begin();
  assert.equal(guard.isCurrent(second), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(second), false);
});
