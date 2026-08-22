export const CONSOLE_SAFETY = {
  custody: false,
  serverSigning: false,
  serverBroadcast: false,
  note: "No private keys are stored or handled on the server. Signing can only happen locally in this browser after an explicit vault unlock, dry-run simulation, and confirmation modal.",
} as const;

export const DISPERSE_ASSET_TYPES = ["NFT", "ERC20"] as const;
export type DisperseAssetType = (typeof DISPERSE_ASSET_TYPES)[number];

export const DISPERSE_CURRENCIES = ["ETH", "USD"] as const;
export type DisperseCurrency = (typeof DISPERSE_CURRENCIES)[number];

export function shortenWallet(wallet: string) {
  if (/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  }

  return wallet;
}
