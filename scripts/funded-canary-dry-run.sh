#!/usr/bin/env bash
set -euo pipefail

# Funded canary dry-run template.
# This script intentionally does not pass --broadcast-confirm, so it cannot
# broadcast. Export a public canary wallet address for validation, or adapt the
# command by hand after reading docs/funded-canary-runbook.md.

: "${CANARY_CHAIN:=base}"
: "${CANARY_CONTRACT:?Set CANARY_CONTRACT to the 0x NFT contract address}"
: "${CANARY_WALLET:?Set CANARY_WALLET to the funded canary public address}"
: "${CANARY_MAX_TOTAL_ETH:?Set CANARY_MAX_TOTAL_ETH, e.g. 0.06}"
: "${CANARY_QUANTITY:=1}"
: "${CANARY_MAX_FEE_GWEI:=2}"
: "${CANARY_PRIORITY_FEE_GWEI:=0.05}"
: "${CANARY_GAS_LIMIT:=250000}"

npm run dev -- canary \
  --chain "$CANARY_CHAIN" \
  --contract "$CANARY_CONTRACT" \
  --wallet hot=CANARY_WALLET \
  --quantity "$CANARY_QUANTITY" \
  --max-total-eth "$CANARY_MAX_TOTAL_ETH" \
  --max-fee-gwei "$CANARY_MAX_FEE_GWEI" \
  --priority-fee-gwei "$CANARY_PRIORITY_FEE_GWEI" \
  --gas-limit "$CANARY_GAS_LIMIT"
