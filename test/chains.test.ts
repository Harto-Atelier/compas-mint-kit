import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENSEA_SEADROP_ADDRESS,
  getChains,
  resolveChain,
  resolveSeaDropAddress,
} from "../src/chains";

test("ethereum mainnet is a first-class built-in chain with its own SeaDrop address", () => {
  const chains = getChains({});
  assert.equal(chains[0].key, "ethereum");

  const ethereum = resolveChain("ethereum", {});
  assert.equal(ethereum?.chainId, 1);
  assert.equal(ethereum?.nativeSymbol, "ETH");
  assert.equal(ethereum?.explorer, "https://etherscan.io");
  assert.equal(ethereum?.seadropAddress, OPENSEA_SEADROP_ADDRESS);
  assert.equal(resolveSeaDropAddress("ethereum", {}), OPENSEA_SEADROP_ADDRESS);
});

test("robinhood chain has verified public network parameters but requires explicit SeaDrop configuration", () => {
  const robinhood = resolveChain("robinhood", {});
  assert.equal(robinhood?.chainId, 4663);
  assert.equal(robinhood?.nativeSymbol, "ETH");
  assert.equal(robinhood?.explorer, "https://robinhoodchain.blockscout.com");
  assert.equal(robinhood?.rpc.public[0], "https://rpc.mainnet.chain.robinhood.com/");
  assert.equal(robinhood?.requiresSeaDropConfig, true);
  assert.equal(robinhood?.seadropAddress, undefined);
  assert.equal(resolveSeaDropAddress("robinhood", {}), undefined);
});

test("per-chain SeaDrop address can be supplied from env without assuming Robinhood matches Ethereum", () => {
  const configured = resolveChain("robinhood", {
    SEADROP_ADDRESS_ROBINHOOD: "0x1111111111111111111111111111111111111111",
  });

  assert.equal(configured?.seadropAddress, "0x1111111111111111111111111111111111111111");
  assert.equal(resolveSeaDropAddress("4663", {
    SEADROP_ADDRESS_ROBINHOOD: "0x1111111111111111111111111111111111111111",
  }), "0x1111111111111111111111111111111111111111");
});

test("custom chain registry JSON supports configurable chainId rpcUrl explorer native symbol and SeaDrop", () => {
  const custom = resolveChain("custom", {
    CHAIN_REGISTRY_JSON: JSON.stringify({
      chains: [
        {
          key: "custom",
          name: "Custom Mainnet",
          chainId: 999,
          rpcUrl: "https://rpc.example.invalid",
          explorer: "https://explorer.example.invalid",
          nativeSymbol: "CETH",
          seadropAddress: "0x2222222222222222222222222222222222222222",
        },
      ],
    }),
  });

  assert.equal(custom?.chainId, 999);
  assert.deepEqual(custom?.rpc.public, ["https://rpc.example.invalid"]);
  assert.equal(custom?.explorer, "https://explorer.example.invalid");
  assert.equal(custom?.nativeSymbol, "CETH");
  assert.equal(custom?.seadropAddress, "0x2222222222222222222222222222222222222222");
});
