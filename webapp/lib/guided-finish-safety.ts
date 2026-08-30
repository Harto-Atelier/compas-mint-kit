import type {
  BrowserMintPlan,
  BrowserPreparedMint,
  BrowserReceiptProviderLike,
  GuidedMintReceipt,
} from "./browser-broadcast";
import {
  assessGuidedFinish,
  readGuidedBurnerBalances,
  type GuidedFinishAssessment,
} from "./guided-holder-flow";

/**
 * Anti-loss finish gate.
 *
 * Before "Finish" is allowed to drop in-memory signer authority, the app must
 * re-read every burner balance from the exact bound chain and re-run the full
 * finish assessment against those fresh balances. Stale UI state is never
 * evidence: a burner that still holds funds (or whose balance cannot be read)
 * blocks finish and routes the holder into the recovery journal / manual exact
 * sweep flow. Nothing here signs, sends, sweeps, or retries anything.
 */
export type GuidedFinishSafetyResult = {
  safe: boolean;
  checkedAt: string;
  /** Fresh chain-bound balances, keyed by lowercase burner address. Null = unknown. */
  balances: Record<string, bigint | null>;
  /** Full finish assessment computed against the fresh balances. */
  assessment: GuidedFinishAssessment;
  /** Set when the chain-bound balance re-read itself failed (wrong chain, RPC down). */
  rpcError: string | null;
};

export async function confirmGuidedFinishResidualSafety(input: {
  holderAddress: string;
  expectedTransactionCount: number;
  plan: BrowserMintPlan;
  transactions: readonly BrowserPreparedMint[];
  receipts: readonly GuidedMintReceipt[];
  provider?: BrowserReceiptProviderLike;
  now?: () => string;
}): Promise<GuidedFinishSafetyResult> {
  const checkedAt = input.now ? input.now() : new Date().toISOString();
  let balances: Record<string, bigint | null>;
  let rpcError: string | null = null;
  try {
    balances = await readGuidedBurnerBalances(input.plan, input.provider);
  } catch (error) {
    // A failed or wrong-chain balance read is never evidence of zero balances.
    // Every planned burner becomes "unknown", which blocks finish fail-closed.
    rpcError = error instanceof Error ? error.message : "Burner balance re-read failed.";
    balances = {};
    for (const transaction of input.plan.transactions) {
      balances[transaction.walletAddress.toLowerCase()] = null;
    }
  }

  const assessment = assessGuidedFinish({
    holderAddress: input.holderAddress,
    expectedTransactionCount: input.expectedTransactionCount,
    transactions: input.transactions,
    receipts: input.receipts,
    burnerBalances: balances,
  });

  return {
    safe: rpcError === null && assessment.ready,
    checkedAt,
    balances,
    assessment,
    rpcError,
  };
}
