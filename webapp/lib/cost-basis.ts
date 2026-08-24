import type { BrowserRunReport, BrowserRunReportTransaction } from "./browser-broadcast";

/**
 * Preview-only cost-basis extraction for Compas Mint Kit run reports.
 *
 * Derives per-wallet mint cost basis in ETH from a browser run report
 * (`buildBrowserRunReport` output) so holder positions can be priced.
 *
 * Kit policies honored here:
 * - No fabricated data: gas cost is `null` unless the report carries both a
 *   per-tx gas estimate AND a gas strategy max fee to price it with.
 * - ETH decimals are rounded to 6 places via `Number(value.toFixed(6))`.
 * - No secrets: `rejectSecretShapedReport` refuses secret-shaped JSON text.
 */

export type CostBasisStatus = "confirmed" | "broadcast" | "unknown";

export interface CostBasisEntry {
  walletAddress: string;
  recipientAddress?: string;
  collectionAddress: string;
  chain: string;
  txHash?: string;
  valueEth: number;
  estimatedGasEth: number | null;
  costBasisEth: number;
  status: CostBasisStatus;
}

export interface CostBasisSummary {
  totalSpentEth: number;
  perWallet: Record<string, number>;
  perRecipient: Record<string, number>;
  count: number;
}

const WEI_PER_ETH = 1e18;
const GWEI_PER_ETH = 1e9;

/** Kit convention: ETH decimal numbers rounded to 6 decimals. */
export function roundEth(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Extract cost-basis entries from a browser run report.
 *
 * Only transactions that actually left the machine are included:
 * - `broadcast` -> status "broadcast"
 * - `confirmed` (future/receipt-enriched reports) -> status "confirmed"
 * - any other unrecognized status that still carries a txHash -> "unknown"
 * - `prepared`, `simulated`, and `failed` rows are excluded.
 *
 * Gas is never invented: `estimatedGasEth` is only computed when the row has
 * a `gasEstimate` (gas units) and the report has a `gasStrategy.maxFeeGwei`
 * to price it with (worst-case ceiling); otherwise it is `null` and
 * `costBasisEth === valueEth`.
 */
export function extractCostBasisFromBrowserReport(report: BrowserRunReport): CostBasisEntry[] {
  const maxFeeGwei = report.gasStrategy?.maxFeeGwei;
  const entries: CostBasisEntry[] = [];

  for (const tx of report.transactions) {
    const status = includedStatusOf(tx);
    if (!status) continue;

    const valueEth = roundEth(weiToEth(tx.valueWei));
    const estimatedGasEth = estimateGasEth(tx.gasEstimate, maxFeeGwei);
    entries.push({
      walletAddress: tx.walletAddress,
      recipientAddress: tx.recipientMode === "payer" ? undefined : tx.recipientAddress,
      collectionAddress: report.collection.address,
      chain: report.chain.key,
      txHash: tx.txHash,
      valueEth,
      estimatedGasEth,
      costBasisEth: roundEth(valueEth + (estimatedGasEth ?? 0)),
      status,
    });
  }

  return entries;
}

/** Sum cost basis totals with 6-decimal rounding. Entries with no explicit
 *  recipient are attributed to the paying wallet in `perRecipient`. */
export function summarizeCostBasis(entries: CostBasisEntry[]): CostBasisSummary {
  const perWallet: Record<string, number> = {};
  const perRecipient: Record<string, number> = {};
  let total = 0;

  for (const entry of entries) {
    total += entry.costBasisEth;
    perWallet[entry.walletAddress] = (perWallet[entry.walletAddress] ?? 0) + entry.costBasisEth;
    const recipient = entry.recipientAddress ?? entry.walletAddress;
    perRecipient[recipient] = (perRecipient[recipient] ?? 0) + entry.costBasisEth;
  }

  for (const key of Object.keys(perWallet)) perWallet[key] = roundEth(perWallet[key]);
  for (const key of Object.keys(perRecipient)) perRecipient[key] = roundEth(perRecipient[key]);

  return {
    totalSpentEth: roundEth(total),
    perWallet,
    perRecipient,
    count: entries.length,
  };
}

const SECRET_KEY_NAME_RE = /(?:private|secret|mnemonic|seed|signedtx|signedtransaction|rawtx|rawtransaction|signingkey|walletkey)/i;
const HASH_FIELD_SCRUB_RE = /"(?:txHash|hash|transactionHash|blockHash|explorerUrl|txUrl|url)"\s*:\s*"[^"]*"/gi;
const HEX_64_RE = /(?:0x)?\b[a-fA-F0-9]{64}\b/;
const JSON_KEY_RE = /"([^"\\]+)"\s*:/g;

/**
 * Mirrors the kit's no-secret policy at the JSON-text level: throws if the
 * report text contains secret-like field names (privateKey/mnemonic/seed/...)
 * or 64-hex private-key-shaped strings outside known tx/block hash fields.
 */
export function rejectSecretShapedReport(json: string): void {
  JSON_KEY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JSON_KEY_RE.exec(json)) !== null) {
    if (SECRET_KEY_NAME_RE.test(match[1])) {
      throw new Error(`Secret-shaped field "${match[1]}" is not allowed in a run report. Import tx hashes/receipts only, never keys.`);
    }
  }

  const scrubbed = json.replace(HASH_FIELD_SCRUB_RE, '"[hash-field]":"[scrubbed]"');
  if (HEX_64_RE.test(scrubbed)) {
    throw new Error("Private-key-shaped 64-hex value found outside tx/block hash fields. Refusing to process secret-shaped report.");
  }
}

function includedStatusOf(tx: BrowserRunReportTransaction): CostBasisStatus | null {
  const raw = String(tx.status);
  if (raw === "confirmed") return "confirmed";
  if (raw === "broadcast") return "broadcast";
  if (raw === "prepared" || raw === "simulated" || raw === "failed") return null;
  return tx.txHash ? "unknown" : null;
}

function weiToEth(valueWei: string): number {
  const parsed = Number(valueWei);
  return Number.isFinite(parsed) ? parsed / WEI_PER_ETH : 0;
}

function estimateGasEth(gasEstimate: string | undefined, maxFeeGwei: number | undefined): number | null {
  if (!gasEstimate || maxFeeGwei === undefined) return null;
  const gasUnits = Number(gasEstimate);
  if (!Number.isFinite(gasUnits) || gasUnits <= 0 || !Number.isFinite(maxFeeGwei) || maxFeeGwei <= 0) return null;
  return roundEth((gasUnits * maxFeeGwei) / GWEI_PER_ETH);
}
