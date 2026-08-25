import { LAUNCH_VAULT_STORAGE_KEY } from "./encrypted-launch-vault";

export const LAUNCH_VAULT_LIFECYCLE_EVENT = "compas-launch-vault:lifecycle";

export type LaunchVaultLifecycleAction = "persist" | "reseal" | "restore" | "wipe" | "rotation";

export type LaunchVaultLifecycleChange = {
  key: typeof LAUNCH_VAULT_STORAGE_KEY;
  action: LaunchVaultLifecycleAction | "storage";
  sourceId: string | null;
  newValue: string | null;
};

export type LaunchVaultStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

type LifecycleEvent = Event & { detail: LaunchVaultLifecycleChange };
type StorageLikeEvent = Event & { key?: string | null; newValue?: string | null };

export function writeLaunchVaultStorage({
  storage,
  eventTarget,
  sourceId,
  action,
  serialized,
}: {
  storage: LaunchVaultStorage;
  eventTarget: EventTarget;
  sourceId: string;
  action: Exclude<LaunchVaultLifecycleAction, "wipe">;
  serialized: string;
}): void {
  storage.setItem(LAUNCH_VAULT_STORAGE_KEY, serialized);
  dispatchLaunchVaultLifecycle(eventTarget, { action, sourceId, newValue: serialized });
}

export function removeLaunchVaultStorage({
  storage,
  eventTarget,
  sourceId,
  action = "wipe",
}: {
  storage: LaunchVaultStorage;
  eventTarget: EventTarget;
  sourceId: string;
  action?: "wipe";
}): void {
  if (!storage.removeItem) throw new Error("Launch Vault storage does not support removal.");
  storage.removeItem(LAUNCH_VAULT_STORAGE_KEY);
  dispatchLaunchVaultLifecycle(eventTarget, { action, sourceId, newValue: null });
}

export function dispatchLaunchVaultLifecycle(
  eventTarget: EventTarget,
  change: Omit<LaunchVaultLifecycleChange, "key">,
): void {
  const event = new Event(LAUNCH_VAULT_LIFECYCLE_EVENT) as LifecycleEvent;
  Object.defineProperty(event, "detail", {
    configurable: false,
    enumerable: true,
    value: { key: LAUNCH_VAULT_STORAGE_KEY, ...change },
  });
  eventTarget.dispatchEvent(event);
}

export function subscribeToLaunchVaultLifecycle(
  eventTarget: EventTarget,
  listener: (change: LaunchVaultLifecycleChange) => void,
  options: { ignoreSourceId?: string } = {},
): () => void {
  const onLifecycle = (event: Event) => {
    const detail = (event as LifecycleEvent).detail;
    if (!detail || detail.key !== LAUNCH_VAULT_STORAGE_KEY || detail.sourceId === options.ignoreSourceId) return;
    listener(detail);
  };
  const onStorage = (event: Event) => {
    const storageEvent = event as StorageLikeEvent;
    if (storageEvent.key !== LAUNCH_VAULT_STORAGE_KEY) return;
    listener({
      key: LAUNCH_VAULT_STORAGE_KEY,
      action: "storage",
      sourceId: null,
      newValue: storageEvent.newValue ?? null,
    });
  };
  eventTarget.addEventListener(LAUNCH_VAULT_LIFECYCLE_EVENT, onLifecycle);
  eventTarget.addEventListener("storage", onStorage);
  return () => {
    eventTarget.removeEventListener(LAUNCH_VAULT_LIFECYCLE_EVENT, onLifecycle);
    eventTarget.removeEventListener("storage", onStorage);
  };
}

export type LaunchVaultGenerationGuard = {
  begin: () => number;
  invalidate: () => number;
  isCurrent: (generation: number) => boolean;
};

export function createLaunchVaultGenerationGuard(): LaunchVaultGenerationGuard {
  let generation = 0;
  return {
    begin: () => generation,
    invalidate: () => {
      generation += 1;
      return generation;
    },
    isCurrent: (candidate) => candidate === generation,
  };
}
