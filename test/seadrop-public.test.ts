import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test, { type TestContext } from "node:test";

import { Interface, parseEther } from "ethers";
import { buildDryRunPlan } from "../src/multi-wallet-planner";
import { buildLocalMintPlan, encodeMintPublic, SEADROP_ADDRESS, type LocalMintPlan } from "../src/seadrop-public";

const PUBLIC_ABI = [
  "function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable",
  "function getPublicDrop(address nftContract) view returns (tuple(uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))",
  "function getAllowedFeeRecipients(address nftContract) view returns (address[])",
];

const IFACE = new Interface(PUBLIC_ABI);
const NFT_CONTRACT = "0x1111111111111111111111111111111111111111";
const FEE_RECIPIENT = "0x2222222222222222222222222222222222222222";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const ETH_MAINNET_DROP = {
  mintPrice: parseEther("0.05"),
  startTime: 1_806_320_400,
  endTime: 1_806_406_800,
  maxTotalMintableByWallet: 4,
  feeBps: 500,
  restrictFeeRecipients: true,
} as const;

test("encodeMintPublic targets the NFT, selected fee recipient, zero recipient override and requested quantity", () => {
  const data = encodeMintPublic(NFT_CONTRACT, FEE_RECIPIENT, 3);
  const decoded = IFACE.decodeFunctionData("mintPublic", data);

  assert.equal(decoded[0], NFT_CONTRACT);
  assert.equal(decoded[1], FEE_RECIPIENT);
  assert.equal(decoded[2], ZERO_ADDRESS);
  assert.equal(decoded[3], 3n);
});

test("buildLocalMintPlan builds an Ethereum mainnet SeaDrop transaction from on-chain public config", async (t) => {
  const rpc = await startSeaDropRpcMock(t);
  const plan = await buildLocalMintPlan(rpc.url, NFT_CONTRACT, 3);

  assert.ok(plan, "expected a local SeaDrop mint plan");
  assert.equal(plan.to, SEADROP_ADDRESS);
  assert.equal(plan.value, parseEther("0.15"));
  assert.equal(plan.feeRecipient, FEE_RECIPIENT);
  assert.deepEqual(plan.drop, {
    mintPrice: ETH_MAINNET_DROP.mintPrice,
    startTime: ETH_MAINNET_DROP.startTime,
    endTime: ETH_MAINNET_DROP.endTime,
    maxTotalMintableByWallet: ETH_MAINNET_DROP.maxTotalMintableByWallet,
    feeBps: ETH_MAINNET_DROP.feeBps,
    restrictFeeRecipients: ETH_MAINNET_DROP.restrictFeeRecipients,
  });

  const decoded = IFACE.decodeFunctionData("mintPublic", plan.data);
  assert.equal(decoded[0], NFT_CONTRACT);
  assert.equal(decoded[1], FEE_RECIPIENT);
  assert.equal(decoded[2], ZERO_ADDRESS);
  assert.equal(decoded[3], 3n);

  assert.deepEqual(rpc.calls, ["getPublicDrop", "getAllowedFeeRecipients"]);
});

test("Ethereum mainnet dry-run transaction plan preserves chain, indexes, quantities and per-wallet caps", () => {
  const mintPlan: LocalMintPlan = {
    to: SEADROP_ADDRESS,
    data: encodeMintPublic(NFT_CONTRACT, FEE_RECIPIENT, 3),
    value: ETH_MAINNET_DROP.mintPrice * 3n,
    feeRecipient: FEE_RECIPIENT,
    drop: {
      mintPrice: ETH_MAINNET_DROP.mintPrice,
      startTime: ETH_MAINNET_DROP.startTime,
      endTime: ETH_MAINNET_DROP.endTime,
      maxTotalMintableByWallet: ETH_MAINNET_DROP.maxTotalMintableByWallet,
      feeBps: ETH_MAINNET_DROP.feeBps,
      restrictFeeRecipients: ETH_MAINNET_DROP.restrictFeeRecipients,
    },
  };

  const plan = buildDryRunPlan({
    chainName: "Ethereum",
    chainId: 1,
    nativeSymbol: "ETH",
    nftContract: NFT_CONTRACT,
    quantity: 3,
    wallets: [
      { alias: "mainnet-hot", envVar: "MAINNET_HOT_KEY", address: "0x0000000000000000000000000000000000000001", sourceKind: "private-key-env" },
      { alias: "mainnet-cold", envVar: "MAINNET_COLD_ADDRESS", address: "0x0000000000000000000000000000000000000002", sourceKind: "address-env" },
    ],
    mintPlan,
    gasLimit: 260_000,
    maxFeePerGas: 35_000_000_000n,
    maxPriorityFeePerGas: 1_500_000_000n,
    concurrency: 1,
    mode: "dry-run",
  });

  assert.deepEqual(plan.chain, { name: "Ethereum", chainId: 1, nativeSymbol: "ETH" });
  assert.equal(plan.seadrop, SEADROP_ADDRESS);
  assert.equal(plan.feeRecipient, FEE_RECIPIENT);
  assert.equal(plan.quantity, 3);
  assert.equal(plan.totals.transactions, 2);
  assert.equal(plan.totals.totalQuantity, 6);
  assert.equal(plan.totals.mintValueWei, parseEther("0.30"));
  assert.deepEqual(plan.perWallet.map((wallet) => wallet.txIndex), [0, 1]);
  assert.deepEqual(plan.perWallet.map((wallet) => wallet.quantity), [3, 3]);
  assert.deepEqual(plan.perWallet.map((wallet) => wallet.mintValueWei), [parseEther("0.15"), parseEther("0.15")]);
  assert.equal(plan.concurrency.width, 1);
  assert.deepEqual(plan.concurrency.batches.map((batch) => batch.map((wallet) => wallet.alias)), [["mainnet-hot"], ["mainnet-cold"]]);
  assert.equal(mintPlan.drop.maxTotalMintableByWallet, 4);
});

async function startSeaDropRpcMock(t: TestContext): Promise<{ url: string; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const response = Array.isArray(payload) ? payload.map((item) => handleRpc(item, calls)) : handleRpc(payload, calls);

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  });

  await listen(server);
  t.after(() => close(server));

  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { url: `http://127.0.0.1:${address.port}`, calls };
}

function handleRpc(payload: { id: number; method: string; params?: unknown[] }, calls: string[]) {
  if (payload.method === "eth_chainId") {
    return { jsonrpc: "2.0", id: payload.id, result: "0x1" };
  }

  if (payload.method === "eth_call") {
    const tx = (payload.params?.[0] ?? {}) as { data?: string; to?: string };
    assert.equal(tx.to?.toLowerCase(), SEADROP_ADDRESS.toLowerCase());

    if (tx.data?.startsWith(IFACE.getFunction("getPublicDrop")!.selector)) {
      calls.push("getPublicDrop");
      return {
        jsonrpc: "2.0",
        id: payload.id,
        result: IFACE.encodeFunctionResult("getPublicDrop", [[
          ETH_MAINNET_DROP.mintPrice,
          ETH_MAINNET_DROP.startTime,
          ETH_MAINNET_DROP.endTime,
          ETH_MAINNET_DROP.maxTotalMintableByWallet,
          ETH_MAINNET_DROP.feeBps,
          ETH_MAINNET_DROP.restrictFeeRecipients,
        ]]),
      };
    }

    if (tx.data?.startsWith(IFACE.getFunction("getAllowedFeeRecipients")!.selector)) {
      calls.push("getAllowedFeeRecipients");
      return {
        jsonrpc: "2.0",
        id: payload.id,
        result: IFACE.encodeFunctionResult("getAllowedFeeRecipients", [[FEE_RECIPIENT]]),
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id: payload.id,
    error: { code: -32601, message: `unsupported mock RPC method ${payload.method}` },
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
