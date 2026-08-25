import { Wallet } from "ethers";
import {
  decryptLaunchVaultBackup,
  encryptLaunchVaultPayload,
  mergeVaultWallets,
  type EncryptedLaunchVaultBackup,
  type LaunchVaultChain,
  type LaunchVaultPayload,
  type ParsedPrivateKeyImport,
} from "./encrypted-launch-vault";

export const MIN_BURNER_COUNT = 1;
export const MAX_BURNER_COUNT = 50;

export interface GenerateBurnerWalletsInput {
  count: number;
  chain?: LaunchVaultChain;
}

export interface GenerateAndSealBurnersInput extends GenerateBurnerWalletsInput {
  encryptedBackup: EncryptedLaunchVaultBackup;
  passphrase: string;
  now?: number;
}

export interface GenerateAndSealBurnersResult {
  encryptedBackup: EncryptedLaunchVaultBackup;
  payload: LaunchVaultPayload;
  added: number;
}

export function normalizeBurnerCount(count: number): number {
  if (!Number.isFinite(count) || !Number.isInteger(count)) {
    throw new Error("Burner count must be a whole number.");
  }
  if (count < MIN_BURNER_COUNT || count > MAX_BURNER_COUNT) {
    throw new Error(`Burner count must be between ${MIN_BURNER_COUNT} and ${MAX_BURNER_COUNT}.`);
  }
  return count;
}

export function generateBurnerWallets(input: GenerateBurnerWalletsInput): ParsedPrivateKeyImport[] {
  const count = normalizeBurnerCount(input.count);
  const chain = input.chain ?? "ETH";

  return Array.from({ length: count }, (_, index) => {
    const wallet = Wallet.createRandom();
    return {
      label: `Burner ${index + 1}`,
      chain,
      address: wallet.address,
      privateKey: wallet.privateKey,
    };
  });
}

export async function generateAndSealBurners(input: GenerateAndSealBurnersInput): Promise<GenerateAndSealBurnersResult> {
  const verifiedVault = await decryptLaunchVaultBackup(input.encryptedBackup, input.passphrase);
  const now = input.now ?? Date.now();
  const burners = generateBurnerWallets(input);
  const merged = mergeVaultWallets(verifiedVault, burners, now);
  const encryptedBackup = await encryptLaunchVaultPayload(merged.payload, input.passphrase, now);

  return {
    encryptedBackup,
    payload: merged.payload,
    added: merged.added,
  };
}
