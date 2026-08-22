"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ScheduleResponse, StageKind } from "@/lib/mint-types";
import {
  createDemoWalletRecords,
  createImportedWalletRecords,
  createInitialPlannerState,
  normalizeWalletCount,
  sanitizeStageQuantity,
  type PlannerWalletDraft,
  type PlannerWalletRecord,
} from "@/lib/planner-store";

type PlannerStoreValue = {
  wallets: PlannerWalletRecord[];
  walletCount: number;
  walletCapacity: number;
  stageQuantities: Record<StageKind, number>;
  scheduleReceipt: ScheduleResponse | null;
  addDemoWallets: () => void;
  addImportedWallets: (drafts: PlannerWalletDraft[]) => number;
  setWalletCount: (value: number) => void;
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

  function clearScheduleReceipt() {
    setScheduleReceiptState(null);
  }

  function addDemoWallets() {
    setWallets((current) => {
      const created = createDemoWalletRecords(current.length);
      const next = [...created, ...current];
      setWalletCountState(next.length);
      return next;
    });
    clearScheduleReceipt();
  }

  function addImportedWallets(drafts: PlannerWalletDraft[]) {
    const imported = createImportedWalletRecords(drafts);
    if (imported.length === 0) return 0;

    setWallets((current) => {
      const next = [...imported, ...current];
      setWalletCountState(next.length);
      return next;
    });
    clearScheduleReceipt();
    return imported.length;
  }

  function setWalletCount(value: number) {
    setWalletCountState(normalizeWalletCount(value, wallets.length));
    clearScheduleReceipt();
  }

  function setStageQuantity(stageId: StageKind, value: number) {
    setStageQuantities((current) => ({ ...current, [stageId]: sanitizeStageQuantity(value) }));
    clearScheduleReceipt();
  }

  function setScheduleReceipt(receipt: ScheduleResponse | null) {
    setScheduleReceiptState(receipt);
  }

  const value: PlannerStoreValue = {
    wallets,
    walletCount: normalizeWalletCount(walletCount, wallets.length),
    walletCapacity: wallets.length,
    stageQuantities,
    scheduleReceipt,
    addDemoWallets,
    addImportedWallets,
    setWalletCount,
    setStageQuantity,
    setScheduleReceipt,
    clearScheduleReceipt,
  };

  return <PlannerStoreContext.Provider value={value}>{children}</PlannerStoreContext.Provider>;
}

export function usePlannerStore() {
  const store = useContext(PlannerStoreContext);
  if (!store) throw new Error("usePlannerStore must be used inside PlannerStoreProvider.");
  return store;
}
