import chalk from "chalk";
import { keccak256 } from "ethers";

export interface RpcEndpoint {
  url: string;
  label: string;
}

export interface BlastResult {
  label: string;
  txHash: string | null;
  error: string | null;
}

// Parse RPC URLs and assign labels
export function parseRpcEndpoints(rpcUrls: string[]): RpcEndpoint[] {
  return rpcUrls.map((url, i) => ({
    url,
    label: labelFromUrl(url, i),
  }));
}

function labelFromUrl(url: string, index: number): string {
  const lower = url.toLowerCase();
  if (lower.includes("sequencer.base.org")) return "mainnet-sequencer.base.org";
  if (lower.includes("sequencer.mainnet.chain.robinhood.com")) return "robinhood-sequencer";
  if (lower.includes("rpc.mainnet.chain.robinhood.com")) return "robinhood-public";
  if (lower.includes("alchemy")) return "ALCHEMY";
  if (lower.includes("flashbots")) return "FLASHBOTS-PROTECT";
  if (lower.includes("llamarpc")) {
    // llamarpc serves several networks — keep the host so the label stays honest
    try { return new URL(url).hostname; } catch { return "llamarpc"; }
  }
  if (lower.includes("quicknode")) return "QUICKNODE";
  if (lower.includes("infura")) return "INFURA";
  if (lower.includes("ankr")) return "ANKR";
  if (lower.includes("publicnode")) return "PUBLICNODE";
  if (lower.includes("cloudflare")) return "CLOUDFLARE";
  try {
    const hostname = new URL(url).hostname;
    return hostname;
  } catch {
    return `RPC[${index}]`;
  }
}

export interface PreparedBlast {
  txHash: string;
  body: string;
}

const RAW_TRANSACTION_LIKE_RE = /0x[0-9a-fA-F]{130,}/g;
const PRIVATE_KEY_LIKE_RE = /(?:^|[^0-9a-fA-F])((?:0x)?[0-9a-fA-F]{64})(?=$|[^0-9a-fA-F])/g;

// Call this BEFORE the fire moment (after signing) — does all compute work upfront
export function prepareBlast(rawTx: string): PreparedBlast {
  return {
    txHash: keccak256(rawTx) as string,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_sendRawTransaction",
      params: [rawTx],
      id: 1,
    }),
  };
}

// Blast a raw signed tx to all RPC endpoints simultaneously — FIRE AND FORGET
// Returns immediately after initiating fetch calls (sub-ms dispatch)
// Responses are collected via the returned promise for logging later
export function blastToAll(
  rawTxOrPrepared: string | PreparedBlast,
  endpoints: RpcEndpoint[]
): { txHash: string; responsePromise: Promise<BlastResult[]> } {
  const prepared: PreparedBlast =
    typeof rawTxOrPrepared === "string"
      ? prepareBlast(rawTxOrPrepared)
      : rawTxOrPrepared;

  const { txHash, body } = prepared;

  // Fire ALL requests — these are initiated immediately (non-blocking)
  const firePromises = endpoints.map((ep) =>
    fetch(ep.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
  );

  // Collect responses asynchronously — caller awaits this AFTER printing dispatch time
  const responsePromise = Promise.allSettled(firePromises).then(async (settled) => {
    const results: BlastResult[] = [];
    for (let i = 0; i < settled.length; i++) {
      const ep = endpoints[i];
      const s = settled[i];
      if (s.status === "fulfilled") {
        try {
          const json = (await s.value.json()) as any;
          if (json.result) {
            console.log(chalk.green(`  [${i}] ${ep.label}  TX: ${json.result}`));
            results.push({ label: ep.label, txHash: json.result, error: null });
          } else if (json.error) {
            const errMsg = redactSensitive(json.error.message || JSON.stringify(json.error));
            if (errMsg.includes("already known") || errMsg.includes("already exists")) {
              console.log(chalk.yellow(`  [${i}] ${ep.label}  ERR: already known`));
            } else {
              console.log(chalk.red(`  [${i}] ${ep.label}  ERR: ${errMsg}`));
            }
            results.push({ label: ep.label, txHash: null, error: errMsg });
          }
        } catch (err: any) {
          const errMsg = redactSensitive(err.message);
          console.log(chalk.red(`  [${i}] ${ep.label}  ERR: ${errMsg}`));
          results.push({ label: ep.label, txHash: null, error: errMsg });
        }
      } else {
        const errMsg = redactSensitive(s.reason?.message || String(s.reason));
        console.log(chalk.red(`  [${i}] ${ep.label}  ERR: ${errMsg}`));
        results.push({ label: ep.label, txHash: null, error: errMsg });
      }
    }
    return results;
  });

  // Return IMMEDIATELY — txHash computed locally, fetches already in flight
  return { txHash, responsePromise };
}

// Wait for tx receipt and return block info
export function redactSensitive(value: unknown): string {
  return String(value ?? "")
    .replace(RAW_TRANSACTION_LIKE_RE, "[redacted-raw-transaction]")
    .replace(PRIVATE_KEY_LIKE_RE, (match, key: string) => match.replace(key, "[redacted-64-hex]"));
}

export async function waitForReceipt(
  txHash: string,
  rpcUrl: string,
  timeoutMs: number = 30000
): Promise<{ block: number; position: number; gasUsed: number; status: string } | null> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getTransactionReceipt",
          params: [txHash],
          id: 1,
        }),
      });

      const json = (await res.json()) as any;
      const receipt = json.result;

      if (receipt) {
        return {
          block: parseInt(receipt.blockNumber, 16),
          position: parseInt(receipt.transactionIndex, 16),
          gasUsed: parseInt(receipt.gasUsed, 16),
          status: receipt.status === "0x1" ? "SUCCESS" : "REVERTED",
        };
      }
    } catch {}

    await new Promise((r) => setTimeout(r, 500));
  }

  return null;
}
