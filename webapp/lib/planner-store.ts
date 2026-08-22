import type { ScheduleResponse, StageKind } from "@/lib/mint-types";
import type { EncryptedVaultWallet } from "@/lib/browser-vault";

export type PlannerWalletChain = "ETH" | "Base";
export type PlannerWalletSource = "demo" | "imported" | "vault";
export type PlannerSecretStatus = "none" | "discarded" | "encrypted" | "unlocked";
export type LaunchVaultStatus = "active" | "archived" | "wiped";
export type RotatePreviousVaultMode = "archive" | "delete";

export type LaunchKeyVaultRecord = {
  launchId: string;
  vaultId: string;
  createdAt: number;
  rotatedFrom?: string;
  status: LaunchVaultStatus;
  walletCount: number;
  encryptedVault: string;
  archivedAt?: number;
  wipedAt?: number;
};

export type PlannerWalletRecord = {
  id: string;
  name: string;
  address: string;
  chain: PlannerWalletChain;
  balance: string;
  source: PlannerWalletSource;
  secretStatus: PlannerSecretStatus;
  createdAt: number;
  encryptedVault?: EncryptedVaultWallet;
};

export type PlannerWalletDraft = {
  name: string;
  address: string;
  chain: PlannerWalletChain;
};

export type PlannerVaultWalletDraft = {
  name: string;
  chain: PlannerWalletChain;
  encryptedVault: EncryptedVaultWallet;
};

export type PlannerWalletSelectionMode = "planner-only" | "encrypted-browser";

export type PlannerSelectedWallet = {
  alias: string;
  address: string;
  source: PlannerWalletSource;
  encryptedVault: boolean;
  unlockedForExecution: boolean;
};

export type PlannerState = {
  wallets: PlannerWalletRecord[];
  walletCount: number;
  stageQuantities: Record<StageKind, number>;
  scheduleReceipt: ScheduleResponse | null;
  activeLaunchId: string;
  launchVaults: LaunchKeyVaultRecord[];
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

export function createInitialPlannerState(createdAt = Date.now()): PlannerState {
  const launchId = `launch-${createdAt}`;
  const vaultId = `vault-${createdAt}`;

  return {
    wallets: SEED_PLANNER_WALLETS,
    walletCount: SEED_PLANNER_WALLETS.length,
    stageQuantities: DEFAULT_STAGE_QUANTITIES,
    scheduleReceipt: null,
    activeLaunchId: launchId,
    launchVaults: [createLaunchVaultRecord({ launchId, vaultId, createdAt, walletCount: SEED_PLANNER_WALLETS.length })],
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
  const capacity = Math.max(0, Math.floor(walletCapacity));
  if (capacity === 0) return 0;
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

export function createVaultWalletRecord(draft: PlannerVaultWalletDraft, createdAt = Date.now()): PlannerWalletRecord {
  if (!isPlannerAddress(draft.encryptedVault.address)) throw new Error("Encrypted vault wallet did not expose a valid public address.");
  return {
    id: `vault-${createdAt}-${draft.encryptedVault.address.slice(2, 8).toLowerCase()}`,
    name: draft.name.trim() || "Encrypted vault wallet",
    address: draft.encryptedVault.address,
    chain: draft.chain,
    balance: "Encrypted in browser",
    source: "vault",
    secretStatus: "encrypted",
    encryptedVault: draft.encryptedVault,
    createdAt,
  };
}

export function selectPlannerWallets(wallets: PlannerWalletRecord[], count: number, mode: PlannerWalletSelectionMode): PlannerSelectedWallet[] {
  const candidates = mode === "encrypted-browser" ? wallets.filter((wallet) => wallet.source === "vault" && wallet.secretStatus === "unlocked") : wallets;
  return candidates.slice(0, Math.max(0, count)).map((wallet, index) => ({
    alias: sanitizeWalletAlias(wallet.name || wallet.id || `wallet-${index + 1}`),
    address: wallet.address,
    source: wallet.source,
    encryptedVault: wallet.source === "vault",
    unlockedForExecution: wallet.source === "vault" && wallet.secretStatus === "unlocked",
  }));
}

export function countUnlockedVaultWallets(wallets: PlannerWalletRecord[]): number {
  return wallets.filter((wallet) => wallet.source === "vault" && wallet.secretStatus === "unlocked").length;
}

export function countVaultWallets(wallets: PlannerWalletRecord[]): number {
  return wallets.filter((wallet) => wallet.source === "vault").length;
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

export function rotatePlannerLaunch(
  state: PlannerState,
  {
    createdAt = Date.now(),
    launchId = `launch-${createdAt}-${randomHex(3)}`,
    vaultId = `vault-${createdAt}-${randomHex(3)}`,
    previousVaultMode = "archive",
  }: {
    createdAt?: number;
    launchId?: string;
    vaultId?: string;
    previousVaultMode?: RotatePreviousVaultMode;
  } = {},
): PlannerState {
  if (state.launchVaults.some((vault) => vault.launchId === launchId)) {
    throw new Error(`Launch ${launchId} already exists.`);
  }
  if (state.launchVaults.some((vault) => vault.vaultId === vaultId)) {
    throw new Error(`Vault ${vaultId} already exists.`);
  }

  const nextVault = createLaunchVaultRecord({
    launchId,
    vaultId,
    createdAt,
    rotatedFrom: state.activeLaunchId,
    walletCount: 0,
  });

  const previousVaults = state.launchVaults
    .map((vault) =>
      vault.launchId === state.activeLaunchId
        ? previousVaultMode === "archive"
          ? { ...vault, status: "archived" as const, archivedAt: createdAt, walletCount: state.wallets.length }
          : null
        : vault,
    )
    .filter((vault): vault is LaunchKeyVaultRecord => vault !== null);

  return {
    ...state,
    wallets: [],
    walletCount: 0,
    scheduleReceipt: null,
    activeLaunchId: launchId,
    launchVaults: [...previousVaults, nextVault],
  };
}

export function confirmWipeLaunchKeys(state: PlannerState, launchId: string, confirmation: string, wipedAt = Date.now()): PlannerState {
  if (confirmation.trim() !== launchId) {
    throw new Error("To confirm wipe, type the launch id exactly.");
  }
  if (launchId === state.activeLaunchId) {
    throw new Error("Rotate away from the active launch before wiping its keys.");
  }

  let found = false;
  const launchVaults = state.launchVaults.map((vault) => {
    if (vault.launchId !== launchId) return vault;
    found = true;
    if (vault.status !== "archived") {
      throw new Error("Only archived launch vaults can be wiped.");
    }

    return {
      launchId: vault.launchId,
      vaultId: vault.vaultId,
      createdAt: vault.createdAt,
      rotatedFrom: vault.rotatedFrom,
      status: "wiped" as const,
      walletCount: 0,
      encryptedVault: createWipedVaultEnvelope(vault.vaultId, wipedAt),
      archivedAt: vault.archivedAt,
      wipedAt,
    } satisfies LaunchKeyVaultRecord;
  });

  if (!found) throw new Error(`Launch ${launchId} was not found.`);
  return { ...state, launchVaults };
}

export function createLaunchVaultRecord({
  launchId,
  vaultId,
  createdAt,
  rotatedFrom,
  walletCount,
}: {
  launchId: string;
  vaultId: string;
  createdAt: number;
  rotatedFrom?: string;
  walletCount: number;
}): LaunchKeyVaultRecord {
  return {
    launchId,
    vaultId,
    createdAt,
    rotatedFrom,
    status: "active",
    walletCount,
    encryptedVault: createEmptyEncryptedVaultEnvelope(vaultId, createdAt),
  };
}

export function syncActiveLaunchVaultWalletCount(state: PlannerState, walletCount: number): PlannerState {
  return {
    ...state,
    launchVaults: state.launchVaults.map((vault) =>
      vault.launchId === state.activeLaunchId && vault.status === "active" ? { ...vault, walletCount } : vault,
    ),
  };
}

function createEmptyEncryptedVaultEnvelope(vaultId: string, createdAt: number) {
  return `encrypted-empty-vault:v1:${encodeVaultToken(vaultId)}:${createdAt}`;
}

function createWipedVaultEnvelope(vaultId: string, wipedAt: number) {
  return `wiped-vault:v1:${encodeVaultToken(vaultId)}:${wipedAt}`;
}

function encodeVaultToken(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function sanitizeWalletAlias(value: string): string {
  const alias = value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "") || "wallet";
  return PRIVATE_KEY_LIKE_PART_RE.test(alias) || RAW_TRANSACTION_LIKE_PART_RE.test(alias) ? "wallet" : alias;
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
