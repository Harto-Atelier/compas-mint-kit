# Funded canary runbook

Use this when you want one final on-chain readiness check before a larger mint wave.
The canary is intentionally narrow: **one chain, one contract, one wallet, one
quantity, one max-cost cap**.

## Safety boundary

- Default mode is validation only: no signing and no broadcast.
- The web console never receives private keys and never broadcasts.
- The local CLI stops before broadcast unless the exact final approval flag is
  present: `--broadcast-confirm I_APPROVE_FUNDED_CANARY`.
- Do not put private keys in `.env`. For broadcast, export a hot-wallet key in the
  current shell only; for dry-run validation, the env var may contain a public
  wallet address.
- Fund the canary wallet with only the amount you are willing to risk for the
  one-wallet test.

## Inputs to lock before running

| Input | Requirement |
| --- | --- |
| Chain | Explicit `--chain ethereum`, `--chain base`, or `--chain robinhood`. |
| Contract | Raw `0x` NFT contract address; do not rely on a slug for canary. |
| Wallet | Exactly one env-var-backed wallet, e.g. `hot=CANARY_WALLET_KEY`. |
| Quantity | Exactly one quantity with `--quantity`; usually `1`. |
| Max cost cap | `--max-total-eth` must cover mint price + `gasLimit × maxFee`, and the CLI aborts if the cap is exceeded. |
| RPC | Prefer a private per-chain RPC (`--rpc`, `--rpc-env`, or `RPC_URL_<CHAIN>`). |
| Approval | No broadcast without `--broadcast-confirm I_APPROVE_FUNDED_CANARY`. |

## 1. Dry-run with a public address first

```bash
export CANARY_WALLET=0xYourFundedCanaryWallet
export RPC_URL_BASE=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY

npm run dev -- canary \
  --chain base \
  --contract 0xYourNftContract \
  --wallet hot=CANARY_WALLET \
  --quantity 1 \
  --max-total-eth 0.06 \
  --max-fee-gwei 2 \
  --priority-fee-gwei 0.05 \
  --gas-limit 250000
```

Expected result: the CLI prints `FUNDED CANARY VALIDATION`, confirms the chain,
RPC, stage, balance, and cap, then prints:

```text
STOPPED BEFORE BROADCAST — dry-run/no-broadcast is the default.
```

If any check fails, fix that input first. Do not move to broadcast while the dry
run is red or warning about public-only RPCs.

## 2. Broadcast only after final operator approval

Use a dedicated hot wallet. Keep the key in the shell session only:

```bash
read -s CANARY_WALLET_KEY
export CANARY_WALLET_KEY

npm run dev -- canary \
  --chain base \
  --contract 0xYourNftContract \
  --wallet hot=CANARY_WALLET_KEY \
  --quantity 1 \
  --max-total-eth 0.06 \
  --max-fee-gwei 2 \
  --priority-fee-gwei 0.05 \
  --gas-limit 250000 \
  --broadcast-confirm I_APPROVE_FUNDED_CANARY
```

With the approval phrase present, the CLI sends exactly one public SeaDrop mint
transaction from the one wallet after repeating the same validations. If the
stage is upcoming, it waits until the on-chain start time; if the stage is live,
it fires immediately.

## Abort conditions

The CLI aborts before signing/broadcast if:

- the wallet env var is missing;
- more than one wallet is supplied;
- the chain key is unknown or the RPC cannot verify the selected chain ID;
- no SeaDrop public stage is readable from the contract;
- the stage has already ended;
- quantity exceeds the public-stage per-wallet max;
- current base fee is above `--max-fee-gwei`;
- wallet balance is below mint value + gas reservation;
- max upfront cost exceeds `--max-total-eth`;
- `--broadcast-confirm` is absent or does not exactly equal
  `I_APPROVE_FUNDED_CANARY`.

## Post-canary

- Record the tx hash and explorer link from CLI output.
- Verify the token receipt/ownership independently before scaling up.
- Re-run dry-run mode for any changed chain, contract, wallet, quantity, gas cap,
  or RPC input.
