"use client";

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ScheduleResponse, StageKind } from "@/lib/mint-types";
import { unlockEncryptedVaultWallet } from "@/lib/browser-vault";
import {
  confirmWipeLaunchKeys,
  createImportedWalletRecords,
  createInitialPlannerState,
  createVaultWalletRecord,
  normalizeWalletCount,
  rotatePlannerLaunch,
  sanitizeStageQuantity,
  syncActiveLaunchVaultWalletCount,
  type LaunchKeyVaultRecord,
  type PlannerState,
  type PlannerVaultWalletDraft,
  type PlannerWalletDraft,
  type PlannerWalletRecord,
  type RotatePreviousVaultMode,
} from "@/lib/planner-store";

type PlannerStoreValue = {
  wallets: PlannerWalletRecord[];
  walletCount: number;
  walletCapacity: number;
  stageQuantities: Record<StageKind, number>;
  scheduleReceipt: ScheduleResponse | null;
  activeLaunchId: string;
  activeLaunchVault: LaunchKeyVaultRecord;
  launchVaults: LaunchKeyVaultRecord[];
  addImportedWallets: (drafts: PlannerWalletDraft[]) => number;
  addEncryptedVaultWallet: (draft: PlannerVaultWalletDraft) => PlannerWalletRecord;
  unlockVaultWallet: (walletId: string, passphrase: string) => Promise<PlannerWalletRecord>;
  getUnlockedVaultPrivateKey: (walletId: string) => string | null;
  rotateForNewLaunch: (previousVaultMode: RotatePreviousVaultMode) => LaunchKeyVaultRecord;
  wipeOldLaunchKeys: (launchId: string, confirmation: string) => void;
  setWalletCount: (value: number, capacityOverride?: number) => void;
  setStageQuantity: (stageId: StageKind, value: number) => void;
  setScheduleReceipt: (receipt: ScheduleResponse | null) => void;
  clearScheduleReceipt: () => void;
};

const PlannerStoreContext = createContext<PlannerStoreValue | null>(null);

export function PlannerStoreProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => createInitialPlannerState(), []);
  const [wallets, setWallets] = useState(initial.wallets);
  const [walletCount, setWalletCountState] = useState(initial.walletCount);
  const [stageQuantities, setStageQuantities] = useState(initial.stageQuantities);
  const [scheduleReceipt, setScheduleReceiptState] = useState<ScheduleResponse | null>(initial.scheduleReceipt);
  const [activeLaunchId, setActiveLaunchId] = useState(initial.activeLaunchId);
  const [launchVaults, setLaunchVaults] = useState(initial.launchVaults);
  const unlockedVaultKeys = useRef(new Map<string, string>());
  const activeLaunchVault = useMemo(
    () => launchVaults.find((vault) => vault.launchId === activeLaunchId) ?? launchVaults[0],
    [activeLaunchId, launchVaults],
  );

  function clearScheduleReceipt() {
    setScheduleReceiptState(null);
  }

  function updateLaunchVaultWalletCount(nextWalletCount: number) {
    setLaunchVaults((currentVaults) => {
      const currentState = stateSnapshot({ wallets, walletCount: nextWalletCount, launchVaults: currentVaults });
      return syncActiveLaunchVaultWalletCount(currentState, nextWalletCount).launchVaults;
    });
  }

  function addImportedWallets(drafts: PlannerWalletDraft[]) {
    const imported = createImportedWalletRecords(drafts);
    if (imported.length === 0) return 0;

    setWallets((current) => {
      const next = [...imported, ...current];
      setWalletCountState(next.length);
      updateLaunchVaultWalletCount(next.length);
      return next;
    });
    clearScheduleReceipt();
    return imported.length;
  }

  function addEncryptedVaultWallet(draft: PlannerVaultWalletDraft): PlannerWalletRecord {
    const record = createVaultWalletRecord(draft);
    setWallets((current) => {
      const next = [record, ...current];
      setWalletCountState(next.length);
      updateLaunchVaultWalletCount(next.length);
      return next;
    });
    clearScheduleReceipt();
    return record;
  }

  async function unlockVaultWallet(walletId: string, passphrase: string): Promise<PlannerWalletRecord> {
    const wallet = wallets.find((candidate) => candidate.id === walletId);
    if (!wallet?.encryptedVault) throw new Error("Encrypted vault wallet not found.");
    const unlocked = await unlockEncryptedVaultWallet(wallet.encryptedVault, passphrase);
    unlockedVaultKeys.current.set(walletId, unlocked.privateKey);
    const unlockedRecord: PlannerWalletRecord = { ...wallet, address: unlocked.address, secretStatus: "unlocked" };
    setWallets((current) => current.map((candidate) => (candidate.id === walletId ? unlockedRecord : candidate)));
    clearScheduleReceipt();
    return unlockedRecord;
  }

  function getUnlockedVaultPrivateKey(walletId: string) {
    return unlockedVaultKeys.current.get(walletId) ?? null;
  }

  function rotateForNewLaunch(previousVaultMode: RotatePreviousVaultMode) {
    unlockedVaultKeys.current.clear();
    const rotated = rotatePlannerLaunch(stateSnapshot({ wallets, walletCount, launchVaults }), { previousVaultMode });
    setWallets(rotated.wallets);
    setWalletCountState(rotated.walletCount);
    setScheduleReceiptState(rotated.scheduleReceipt);
    setActiveLaunchId(rotated.activeLaunchId);
    setLaunchVaults(rotated.launchVaults);
    return rotated.launchVaults.find((vault) => vault.launchId === rotated.activeLaunchId)!;
  }

  function wipeOldLaunchKeys(launchId: string, confirmation: string) {
    const wiped = confirmWipeLaunchKeys(stateSnapshot({ wallets, walletCount, launchVaults }), launchId, confirmation);
    setLaunchVaults(wiped.launchVaults);
  }

  function setWalletCount(value: number, capacityOverride = wallets.length) {
    setWalletCountState(normalizeWalletCount(value, capacityOverride));
    clearScheduleReceipt();
  }

  function setStageQuantity(stageId: StageKind, value: number) {
    setStageQuantities((current) => ({ ...current, [stageId]: sanitizeStageQuantity(value) }));
    clearScheduleReceipt();
  }

  function setScheduleReceipt(receipt: ScheduleResponse | null) {
    setScheduleReceiptState(receipt);
  }

  if (!activeLaunchVault) throw new Error("Planner store has no active launch vault.");

  const value: PlannerStoreValue = {
    wallets,
    walletCount: normalizeWalletCount(walletCount, wallets.length),
    walletCapacity: wallets.length,
    stageQuantities,
    scheduleReceipt,
    activeLaunchId,
    activeLaunchVault,
    launchVaults,
    addImportedWallets,
    addEncryptedVaultWallet,
    unlockVaultWallet,
    getUnlockedVaultPrivateKey,
    rotateForNewLaunch,
    wipeOldLaunchKeys,
    setWalletCount,
    setStageQuantity,
    setScheduleReceipt,
    clearScheduleReceipt,
  };

  return <PlannerStoreContext.Provider value={value}>{children}</PlannerStoreContext.Provider>;

  function stateSnapshot(overrides: { wallets: PlannerWalletRecord[]; walletCount: number; launchVaults: LaunchKeyVaultRecord[] }): PlannerState {
    return {
      wallets: overrides.wallets,
      walletCount: overrides.walletCount,
      stageQuantities,
      scheduleReceipt,
      activeLaunchId,
      launchVaults: overrides.launchVaults,
    };
  }
}

export function usePlannerStore() {
  const store = useContext(PlannerStoreContext);
  if (!store) throw new Error("usePlannerStore must be used inside PlannerStoreProvider.");
  return store;
}
