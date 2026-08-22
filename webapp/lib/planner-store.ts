import type { ScheduleResponse, StageKind } from "@/lib/mint-types";

export type PlannerWalletChain = "ETH" | "Base";
export type PlannerWalletSource = "demo" | "imported";
export type PlannerSecretStatus = "none" | "discarded";

export type PlannerWalletRecord = {
  id: string;
  name: string;
  address: string;
  chain: PlannerWalletChain;
  balance: string;
  source: PlannerWalletSource;
  secretStatus: PlannerSecretStatus;
  createdAt: number;
};

export type PlannerWalletDraft = {
  name: string;
  address: string;
  chain: PlannerWalletChain;
};

export type PlannerState = {
  wallets: PlannerWalletRecord[];
  walletCount: number;
  stageQuantities: Record<StageKind, number>;
  scheduleReceipt: ScheduleResponse | null;
};

export const PLANNER_CHAINS: PlannerWalletChain[] = ["ETH", "Base"];

export const DEFAULT_STAGE_QUANTITIES: Record<StageKind, number> = {
  team: 0,
  gtd: 0,
  fcfs: 0,
  public: 1,
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const PRIVATE_KEY_LIKE_PART_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;
const RAW_TRANSACTION_LIKE_PART_RE = /^0x[0-9a-fA-F]{130,}$/;

export const SEED_PLANNER_WALLETS: PlannerWalletRecord[] = [
  {
    id: "seed-eth-ops",
    name: "Mint ops demo",
    address: "0x7E57f9dC2B63aC108F0E47aE0D51f5130A8a12B4",
    chain: "ETH",
    balance: "0.42 ETH demo",
    source: "demo",
    secretStatus: "none",
    createdAt: 1,
  },
  {
    id: "seed-base-review",
    name: "Base review demo",
    address: "0xbA5E3f1D210F6F4318731D1dE7f4D91A8A9b00C0",
    chain: "Base",
    balance: "1.80 ETH demo",
    source: "demo",
    secretStatus: "none",
    createdAt: 2,
  },
];

export function createInitialPlannerState(): PlannerState {
  return {
    wallets: SEED_PLANNER_WALLETS,
    walletCount: SEED_PLANNER_WALLETS.length,
    stageQuantities: DEFAULT_STAGE_QUANTITIES,
    scheduleReceipt: null,
  };
}

export function isPlannerAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function shortenWalletAddress(address: string) {
  if (!isPlannerAddress(address)) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function normalizeWalletCount(value: number, walletCapacity: number) {
  const capacity = Math.max(1, Math.floor(walletCapacity));
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count)) return 1;
  return Math.min(Math.max(count, 1), capacity);
}

export function sanitizeStageQuantity(value: number) {
  const quantity = Math.floor(Number(value));
  if (!Number.isFinite(quantity) || quantity < 0) return 0;
  return Math.min(quantity, 100);
}

export function parseBulkWalletImport(raw: string, fallbackChain: PlannerWalletChain): PlannerWalletDraft[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line
        .split(/[\t,]/)
        .map((part) => part.trim())
        .filter(Boolean);
      const addressIndex = parts.findIndex((part) => isPlannerAddress(part));
      const address = addressIndex >= 0 ? parts[addressIndex] : "";
      const publicNameParts = addressIndex > 0 ? parts.slice(0, addressIndex).filter((part) => !isSecretLikeImportPart(part)) : [];
      const name = publicNameParts.length > 0 ? publicNameParts.join(" ") : `Imported wallet ${index + 1}`;

      return {
        name: name || `Imported wallet ${index + 1}`,
        address,
        chain: fallbackChain,
      };
    })
    .filter((wallet) => isPlannerAddress(wallet.address));
}

export function createImportedWalletRecords(drafts: PlannerWalletDraft[], createdAt = Date.now()): PlannerWalletRecord[] {
  return drafts.filter((draft) => isPlannerAddress(draft.address)).map((wallet, index) => ({
    id: `import-${createdAt}-${index}`,
    name: wallet.name.trim() || "Imported wallet",
    address: wallet.address.trim(),
    chain: wallet.chain,
    balance: "Not connected",
    source: "imported",
    secretStatus: "discarded",
    createdAt: createdAt + index,
  }));
}

export function createDemoWalletRecords(currentCount: number, createdAt = Date.now(), hexFactory: (bytes: number, salt: number) => string = randomHex): PlannerWalletRecord[] {
  return [0, 1].map((offset) => {
    const count = currentCount + offset;
    const chain: PlannerWalletChain = count % 2 === 0 ? "ETH" : "Base";
    const safeDemoBalance = chain === "ETH" ? "0.00 ETH demo" : "0.05 ETH demo";
    const address = `0x${hexFactory(20, count)}`;

    return {
      id: `demo-${createdAt}-${count}`,
      name: `Demo wallet ${count + 1}`,
      address: isPlannerAddress(address) && address !== ZERO_ADDRESS ? address : fallbackDemoAddress(count),
      chain,
      balance: safeDemoBalance,
      source: "demo",
      secretStatus: "none",
      createdAt: createdAt + offset,
    };
  });
}

function randomHex(bytes: number) {
  const browserCrypto = typeof crypto !== "undefined" ? crypto : null;
  if (browserCrypto?.getRandomValues) {
    const buffer = new Uint8Array(bytes);
    browserCrypto.getRandomValues(buffer);
    return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return Array.from({ length: bytes }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");
}

function fallbackDemoAddress(count: number) {
  const suffix = count.toString(16).padStart(40, "0").slice(-40);
  return `0x${suffix}`;
}

function isSecretLikeImportPart(value: string) {
  const trimmed = value.trim();
  return PRIVATE_KEY_LIKE_PART_RE.test(trimmed) || RAW_TRANSACTION_LIKE_PART_RE.test(trimmed);
}
