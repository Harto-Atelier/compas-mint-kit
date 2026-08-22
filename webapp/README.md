# Compas Mint Console

Local web console for planning Compas mint waves before anything touches a
private key. This app is the browser-side planner for the root
`compas-mint-kit` CLI.

## What the console does

- Discover a collection from an OpenSea slug/link, item URL, or raw `0x`
  contract address.
- Review stage cards for public, team, GTD, and FCFS-style mint phases.
- Price wallet waves with quantity, wallet count, gas limit, max-fee, and
  optional sweep-destination labels. The webapp never moves or sweeps funds.
- Produce a preview schedule/run config that can be carried to the local CLI.
- Support the current kit chains: **Ethereum**, **Base**, and **Robinhood Chain**.

## What it deliberately does not do

- No private keys, seed phrases, or wallet imports in the browser.
- No browser signing.
- No transaction broadcast endpoint.
- No mainnet execution button.

The schedule API returns `canBroadcast: false` on purpose. Future live broadcast
support belongs in the local CLI only, where hot-wallet keys are entered at run
time and the operator explicitly confirms the final send.

## Run locally

```bash
cd webapp
npm install
npm run dev
```

Open <http://localhost:3000>.

## Planner → CLI handoff

The web console is the planning lane; the CLI is the execution lane.

1. Use the console to discover the collection and review supported stages.
2. Set quantities, wallet count, gas limit, max fee, and optional sweep destination label.
3. Save/export the preview schedule as the run config handoff.
4. Move that config to the root CLI on the same machine that owns the hot-wallet
   keys.
5. Dry-run locally first: verify RPC chain ID, balances, gas ceiling, calldata,
   stage timing, and per-wallet limits.
6. Broadcast only from the local CLI after explicit operator confirmation.

The run config should contain only planning data:

```json
{
  "chain": "base",
  "collection": "0x...",
  "selectedStages": [
    { "stageId": "public", "quantity": 1, "fireAt": "2026-01-01T00:00:00.000Z" }
  ],
  "walletCount": 3,
  "gasLimit": 250000,
  "maxFeeGwei": 0.08,
  "sweepDestinationLabel": "0x... optional preview metadata only",
  "warnings": ["No sweep is executed by the webapp"]
}
```

It must not contain private keys, mnemonic phrases, wallet files, cookies, or RPC
provider secrets.

## APIs

- `GET /api/mints/discover?q=<slug-or-address>&chain=<ethereum|base|robinhood>`
  discovers collection metadata and previewable stage information.
- `POST /api/mints/schedule` builds the no-broadcast schedule/run config and
  returns totals, timing, warnings, and `canBroadcast: false`.

## Compa holder courtesy

This console is packaged as a courtesy utility for Compa holders, but the fork is
open-source and does not enforce holder ownership in code. Please keep the
original upstream credit intact when sharing or modifying the kit.
