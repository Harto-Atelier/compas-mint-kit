export const PREVIEW_SAFETY = {
  previewOnly: true,
  source: "static-placeholder",
  status: "non-executing-preview",
  execution: "none",
  broadcast: false,
  custody: false,
  signing: false,
  note: "Static UI placeholders only. This webapp does not hold keys, sign transactions, or broadcast anything.",
} as const;

export const DISPERSE_ASSET_TYPES = ["NFT", "ERC20"] as const;
export type DisperseAssetType = (typeof DISPERSE_ASSET_TYPES)[number];

export const DISPERSE_CURRENCIES = ["ETH", "USD"] as const;
export type DisperseCurrency = (typeof DISPERSE_CURRENCIES)[number];

export const COLLECTION_TABS = ["Minted", "Transactions", "Analytics"] as const;
export type CollectionTab = (typeof COLLECTION_TABS)[number];

export type PlaceholderSource = typeof PREVIEW_SAFETY.source;

export type WalletPreview = {
  label: string;
  wallet: string;
  role: "sender" | "recipient" | "operator";
  source: PlaceholderSource;
  configured: false;
  note: string;
};

export type DispersePreview = {
  assetType: DisperseAssetType;
  mode: "Flat";
  amountPerWallet: string;
  currency: DisperseCurrency;
  senders: WalletPreview[];
  recipients: WalletPreview[];
  source: PlaceholderSource;
  status: "draft-placeholder";
  note: string;
};

export type AcoPlaceholder = {
  label: string;
  state: "watch-only" | "scheduled-review" | "manual-review";
  cadence: string;
  nextWindow: string;
  source: PlaceholderSource;
  configured: false;
  execution: "none";
  broadcast: false;
  note: string;
};

export type MintRow = {
  id: string;
  wallet: string;
  amount: string;
  gas: string;
  status: "minted-preview" | "scheduled" | "queued" | "manual-review" | "alert-only";
  source: PlaceholderSource;
  note: string;
};

export type QueueRow = MintRow & {
  eta: string;
  lane: "Disperse" | "ACO" | "Mint console";
};

export type AnalyticsMetric = {
  label: string;
  value: string;
  detail: string;
  source: PlaceholderSource;
  note: string;
};

const note = "Preview fixture; not read from a wallet, contract, mempool, signer, or broadcaster.";

export const DISPERSE_PREVIEW: DispersePreview = {
  assetType: "NFT",
  mode: "Flat",
  amountPerWallet: "1",
  currency: "ETH",
  source: PREVIEW_SAFETY.source,
  status: "draft-placeholder",
  note: "Disperse builder mirrors the Umi reference shape, but the action is disabled and cannot broadcast.",
  senders: [
    {
      label: "Sender 01",
      wallet: "preview-sender-01",
      role: "sender",
      source: PREVIEW_SAFETY.source,
      configured: false,
      note,
    },
    {
      label: "Sender 02",
      wallet: "preview-sender-02",
      role: "sender",
      source: PREVIEW_SAFETY.source,
      configured: false,
      note,
    },
  ],
  recipients: [
    {
      label: "Recipient 01",
      wallet: "preview-recipient-01",
      role: "recipient",
      source: PREVIEW_SAFETY.source,
      configured: false,
      note,
    },
    {
      label: "Recipient 02",
      wallet: "preview-recipient-02",
      role: "recipient",
      source: PREVIEW_SAFETY.source,
      configured: false,
      note,
    },
    {
      label: "Recipient 03",
      wallet: "preview-recipient-03",
      role: "recipient",
      source: PREVIEW_SAFETY.source,
      configured: false,
      note,
    },
  ],
};

export const ACO_PLACEHOLDERS: AcoPlaceholder[] = [
  {
    label: "ACO mint window watcher",
    state: "watch-only",
    cadence: "Every 30s during preview",
    nextWindow: "Drop opens in 18m",
    source: PREVIEW_SAFETY.source,
    configured: false,
    execution: "none",
    broadcast: false,
    note: "Ranks collection readiness and gas posture only; does not prepare calldata or submit transactions.",
  },
  {
    label: "ACO holder review queue",
    state: "scheduled-review",
    cadence: "Manual checkpoint",
    nextWindow: "Operator review at T-10m",
    source: PREVIEW_SAFETY.source,
    configured: false,
    execution: "none",
    broadcast: false,
    note: "Schedules rows for review so a human can decide outside this preview UI.",
  },
  {
    label: "ACO risk guard",
    state: "manual-review",
    cadence: "On gas spike",
    nextWindow: "Alert-only if base fee moves +20%",
    source: PREVIEW_SAFETY.source,
    configured: false,
    execution: "none",
    broadcast: false,
    note: "Creates alert copy only; no signer, private key, relay, or RPC blast is connected.",
  },
];

export const MINTED_ROWS: MintRow[] = [
  {
    id: "mint-preview-001",
    wallet: "preview-minted-wallet-01",
    amount: "1 NFT",
    gas: "0.00042 ETH",
    status: "minted-preview",
    source: PREVIEW_SAFETY.source,
    note,
  },
  {
    id: "mint-preview-002",
    wallet: "preview-minted-wallet-02",
    amount: "1 NFT",
    gas: "0.00039 ETH",
    status: "minted-preview",
    source: PREVIEW_SAFETY.source,
    note,
  },
  {
    id: "mint-preview-003",
    wallet: "preview-minted-wallet-03",
    amount: "2 NFT",
    gas: "0.00061 ETH",
    status: "manual-review",
    source: PREVIEW_SAFETY.source,
    note,
  },
];

export const TRANSACTION_ROWS: MintRow[] = [
  {
    id: "tx-preview-001",
    wallet: "preview-tx-wallet-01",
    amount: "1 NFT",
    gas: "target 0.00046 ETH",
    status: "scheduled",
    source: PREVIEW_SAFETY.source,
    note,
  },
  {
    id: "tx-preview-002",
    wallet: "preview-tx-wallet-02",
    amount: "1 NFT",
    gas: "target 0.00044 ETH",
    status: "queued",
    source: PREVIEW_SAFETY.source,
    note,
  },
  {
    id: "tx-preview-003",
    wallet: "preview-tx-wallet-03",
    amount: "0.08 ERC20",
    gas: "target 0.00021 ETH",
    status: "alert-only",
    source: PREVIEW_SAFETY.source,
    note,
  },
];

export const ANALYTICS_ROWS: MintRow[] = [
  {
    id: "analytics-preview-001",
    wallet: "preview-analytics-wallet-01",
    amount: "3 planned",
    gas: "p50 0.00044 ETH",
    status: "scheduled",
    source: PREVIEW_SAFETY.source,
    note,
  },
  {
    id: "analytics-preview-002",
    wallet: "preview-analytics-wallet-02",
    amount: "2 planned",
    gas: "p95 0.00068 ETH",
    status: "manual-review",
    source: PREVIEW_SAFETY.source,
    note,
  },
  {
    id: "analytics-preview-003",
    wallet: "preview-analytics-wallet-03",
    amount: "1 planned",
    gas: "watch 0.00040 ETH",
    status: "alert-only",
    source: PREVIEW_SAFETY.source,
    note,
  },
];

export const COLLECTION_ROWS: Record<CollectionTab, MintRow[]> = {
  Minted: MINTED_ROWS,
  Transactions: TRANSACTION_ROWS,
  Analytics: ANALYTICS_ROWS,
};

export const TRANSACTION_QUEUE: QueueRow[] = [
  {
    ...TRANSACTION_ROWS[0],
    eta: "T-15m",
    lane: "Mint console",
  },
  {
    ...TRANSACTION_ROWS[1],
    eta: "T-10m",
    lane: "Disperse",
  },
  {
    ...TRANSACTION_ROWS[2],
    eta: "T-05m",
    lane: "ACO",
  },
];

export const ANALYTICS_METRICS: AnalyticsMetric[] = [
  {
    label: "Preview wallets",
    value: "8",
    detail: "5 mint rows · 3 Disperse recipients",
    source: PREVIEW_SAFETY.source,
    note,
  },
  {
    label: "Scheduled rows",
    value: "3",
    detail: "All marked no-broadcast",
    source: PREVIEW_SAFETY.source,
    note,
  },
  {
    label: "Gas envelope",
    value: "0.00021–0.00068 ETH",
    detail: "Fixture range for layout testing",
    source: PREVIEW_SAFETY.source,
    note,
  },
];

export function shortenWallet(wallet: string) {
  if (/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  }

  return wallet;
}
