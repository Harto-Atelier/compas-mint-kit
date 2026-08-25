// Public-mint execution with no OpenSea in the loop.
//
// Because the calldata is known ahead of time (see seadrop-public.ts), every
// transaction can be signed and serialised *before* the stage opens. At T-0 the
// only work left is writing bytes to sockets — no API poll, no signing, no
// encoding. That is strictly faster than the OpenSea path, which cannot sign
// until the API hands over calldata roughly a second after the stage starts.

import chalk from "chalk";
import { performance } from "perf_hooks";
import { JsonRpcProvider, Wallet, formatEther } from "ethers";
import { parseRpcEndpoints, prepareBlast, waitForReceipt, type PreparedBlast } from "./rpc-blast";
import { relaySameHashToRpcs, type FastRelayRaceResult } from "./fast-relay";
import { warmConnections } from "./connection-warmer";
import { waitForMintTime } from "./timer";
import { explorerTx } from "./chains";
import { LocalMintPlan } from "./seadrop-public";

export interface LocalSnipeOpts {
  nftContract: string;
  quantity: number;
  walletKeys: string[];
  rpcUrls: string[];
  maxFeePerGas: bigint;
  maxPriorityFee: bigint;
  gasLimit: number;
  targetStart: Date | null;
  plan: LocalMintPlan;
}

export async function localPublicSnipe(opts: LocalSnipeOpts): Promise<void> {
  const {
    nftContract, quantity, walletKeys, rpcUrls,
    maxFeePerGas, maxPriorityFee, gasLimit, targetStart, plan,
  } = opts;

  const provider = new JsonRpcProvider(rpcUrls[0]);
  const endpoints = parseRpcEndpoints(rpcUrls);
  const wallets = walletKeys.map((k) => new Wallet(k, provider));

  console.log(chalk.bold.magenta("\n── LOCAL PUBLIC MINT (no OpenSea) ──"));
  console.log(chalk.gray(`  SeaDrop:       ${plan.to}`));
  console.log(chalk.gray(`  NFT:           ${nftContract}`));
  console.log(chalk.gray(`  Fee recipient: ${plan.feeRecipient}`));
  console.log(
    chalk.gray(
      `  Price:         ${formatEther(plan.drop.mintPrice)} × ${quantity} = ${formatEther(plan.value)} per wallet`
    )
  );
  console.log(chalk.gray(`  Calldata:      ${(plan.data.length - 2) / 2} bytes (identical for every wallet)`));

  // ── Warm sockets and pre-fetch everything the signature depends on ──
  await warmConnections(rpcUrls);

  const [nonces, network] = await Promise.all([
    Promise.all(wallets.map((w) => provider.getTransactionCount(w.address, "pending"))),
    provider.getNetwork(),
  ]);
  const chainId = network.chainId;
  console.log(chalk.gray(`  Nonces: [${nonces.join(", ")}] | chainId: ${chainId}`));

  // ── Sign everything now, well before the stage opens ──
  const signStart = performance.now();
  const prepared: { idx: number; address: string; blast: PreparedBlast }[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const rawTx = await wallets[i].signTransaction({
      to: plan.to,
      data: plan.data,
      value: plan.value,
      nonce: nonces[i],
      maxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFee,
      gasLimit: gasLimit || 250_000,
      type: 2,
      chainId,
    });
    prepared.push({ idx: i, address: wallets[i].address, blast: prepareBlast(rawTx) });
  }

  console.log(
    chalk.green(
      `  ✓ ${prepared.length} tx(s) signed and serialised in ${(performance.now() - signStart).toFixed(1)}ms — nothing left to compute at fire time`
    )
  );

  // ── Wait for the stage, then blast pre-built bytes ──
  if (targetStart) {
    await waitForMintTime(targetStart, 0);
  } else {
    console.log(chalk.bold.yellow("\n  🚀 Firing immediately..."));
  }

  const stageStartMs = targetStart ? targetStart.getTime() : Date.now();
  const dispatchStart = performance.now();

  const fired = prepared.map(({ idx, address, blast }) => ({
    idx,
    address,
    txHash: blast.txHash,
    racePromise: relaySameHashToRpcs(blast, endpoints),
  }));

  const dispatchMs = (performance.now() - dispatchStart).toFixed(2);
  const sinceStage = Math.max(0, Date.now() - stageStartMs);
  console.log(
    chalk.bold.green(`  DISPATCHED ${fired.length} tx(s) (${dispatchMs}ms, +${sinceStage}ms after stage)`)
  );
  for (const f of fired) {
    console.log(chalk.gray(`    [W${f.idx}] ${f.txHash}`));
  }

  // Dispatch only means "bytes written". Aggregate every RPC response using
  // same-hash race semantics before promising a receipt that may never exist.
  const settled = await Promise.all(
    fired.map(async (f) => ({ ...f, race: await f.racePromise }))
  );

  for (const { idx, race } of settled) printFastRelayRace(idx, race);

  const accepted = settled.filter(({ race }) => race.state === "ACCEPTED");
  const ambiguous = settled.filter(({ race }) => race.state === "AMBIGUOUS");
  const rejected = settled.filter(({ race }) => race.state === "REJECTED");

  for (const { idx, race } of rejected) {
    const reasons = [...new Set(race.rejectedBy.map((r) => r.error).filter((r): r is string => Boolean(r)))];
    console.log(chalk.bold.red(`\n  ✗ [W${idx}] REJECTED by every RPC — never accepted.`));
    for (const reason of reasons) console.log(chalk.red(`      ${reason}`));
    if (reasons.some((r) => r.includes("less than block base fee"))) {
      console.log(chalk.yellow("      → Your max fee is under the chain's base fee. Raise it and re-run."));
    }
  }

  for (const { idx, txHash, race } of ambiguous) {
    const reasons = [...new Set(race.ambiguousRoutes.map((r) => r.error ?? r.outcome))];
    console.log(chalk.bold.yellow(`\n  ? [W${idx}] AMBIGUOUS — no RPC accepted ${txHash}, but at least one route timed out/rate-limited/misreported.`));
    for (const reason of reasons) console.log(chalk.yellow(`      ${reason}`));
    console.log(chalk.yellow("      → Do not replace, bump gas, or re-sign until you verify the hash externally."));
  }

  if (accepted.length === 0) {
    console.log(chalk.bold.yellow("\n===== NO DEFINITE ACCEPTANCE — no receipts to wait for yet =====\n"));
    return;
  }

  // ── Receipts (only for txs an endpoint actually accepted) ──
  console.log(chalk.gray("\n  Waiting for receipts..."));
  await Promise.all(
    accepted.map(async ({ idx, txHash }) => {
      const receipt = await waitForReceipt(txHash, rpcUrls[0], 60_000);
      if (!receipt) {
        console.log(chalk.yellow(`  [W${idx}] TIMEOUT — check: ${explorerTx(chainId, txHash)}`));
        return;
      }
      const color = receipt.status === "SUCCESS" ? chalk.bold.green : chalk.bold.red;
      console.log(
        color(`  [W${idx}] Block: ${receipt.block} | Pos: ${receipt.position} | ${receipt.status} | Gas: ${receipt.gasUsed}`)
      );
      console.log(chalk.gray(`  [W${idx}] Track: ${explorerTx(chainId, txHash)}`));
    })
  );

  console.log(chalk.bold.white("\n===== LOCAL PUBLIC MINT COMPLETE ====="));
}

function printFastRelayRace(walletIndex: number, race: FastRelayRaceResult): void {
  const color = race.state === "ACCEPTED" ? chalk.green : race.state === "REJECTED" ? chalk.red : chalk.yellow;
  console.log(color(`\n  [W${walletIndex}] Fast relay ${race.state}: ${race.expectedTxHash}`));
  for (const route of race.routes) {
    const detail = route.txHash ?? route.error ?? route.outcome;
    console.log(color(`    ${route.label}: ${route.outcome}${detail ? ` — ${detail}` : ""}`));
  }
}
