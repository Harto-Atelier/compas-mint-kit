# Compas Mint Kit Low-Latency Mint Architecture

> Phase 1 starts with measurement and deterministic transaction identity. Latency work must not weaken Vault, consent, receipt, recovery, or Safe Finish guarantees.

## Target split

```text
Vercel = UI / holder auth / discovery / planning / relay-token issuance
Browser = Vault / burner keys / simulation / consent / local signing / expected hash calculation
Fast Relay VPS = transport of already-signed transactions only
RPC / Sequencer = execution
```

The relay must never receive private keys, mnemonics, Vault passphrases, holder signing authority, or any ability to mutate a transaction after consent.

## P0 audit: current browser hot path

Audited file: `webapp/lib/browser-broadcast.ts`.

### Current prepare path

`buildBrowserMintPlan(...)` currently happens before live broadcast and already binds:

- `chainKey`
- `chainId`
- `rpcUrl`
- `seaDropAddress`
- `collectionAddress`
- `recipientMode`
- `recipientAddress`
- selected wallet addresses
- aggregate value cap
- configured `gasLimit` when present
- configured `maxFeePerGasWei` when present
- executable SeaDrop stages: id, quantity, price, feeRecipient
- encoded SeaDrop `mintPublic(...)` calldata
- transaction `value`
- in-memory signer context via `WeakMap`

Current gap for low-latency mode: nonce and complete fee fields are not bound here. If `gasLimit`/fee are missing, ethers/provider work can happen during `wallet.sendTransaction(...)`.

### Current simulation path

`simulatePreparedBrowserMint(...)` runs before live broadcast:

1. creates/uses JSON-RPC provider;
2. `getNetwork()` chain check;
3. `call(...)` simulation;
4. `estimateGas(...)`;
5. marks transaction `simulated` and stores `simulationGas`.

This is good outside the final hot path, but Phase 1 should explicitly make simulation a Prepare-stage requirement and fail closed if fees/nonces are absent for Low-Latency.

### Current final live broadcast path

`broadcastPreparedBrowserMint(tx, deps)` currently does this after explicit final consent:

1. Validate `tx.status === "simulated"`.
2. Validate explicit consent boolean.
3. Read signer context from `TX_CONTEXT` `WeakMap`.
4. Validate signer not revoked and not already broadcasting.
5. Validate `consentBinding` equals current deterministic plan binding.
6. Decode/review calldata via `reviewPreparedBrowserMintCalldata(...)`.
7. Mark row as `broadcasting`.
8. Create/use provider.
9. RPC `getNetwork()` chain check **during live broadcast**.
10. Check authority still current.
11. Consume signer authority and delete the `WeakMap` context.
12. Construct `ethers.Wallet(privateKey, provider)` or injected wallet.
13. Check authority again.
14. Call `wallet.sendTransaction(tx.request)`.
15. Validate returned hash shape.
16. Mark row `broadcast` and attach explorer URL.
17. On send error: mark row `failed`, `broadcastAttempted: true`, signer already revoked.

### What is sequential today

At the single-row function level, the following are sequential during live broadcast:

- consent/context validation;
- calldata review;
- provider readiness;
- RPC chain check;
- signer authority consumption;
- wallet construction;
- `wallet.sendTransaction(...)`.

Inside ethers `wallet.sendTransaction(...)`, if request fields are missing, provider-backed work can happen before `eth_sendRawTransaction`, typically:

- nonce lookup;
- fee lookup / gas population;
- chain population where needed;
- local signing;
- raw transaction serialization;
- `eth_sendRawTransaction`.

The current code does **not** separately time these internal ethers sub-stages, and it does not precompute the expected transaction hash before broadcast.

### Does it do these during live broadcast?

| Check | Current status |
|---|---|
| RPC chain check | **Yes**, `getNetwork()` inside `broadcastPreparedBrowserMint` |
| Nonce lookup | **Likely yes inside ethers** unless already populated; nonce is not currently bound in `BrowserPreparedMintRequest` |
| Balance lookup | Not explicit in `broadcastPreparedBrowserMint`; may happen elsewhere/funding, but not in this function |
| Gas estimation | Not explicit in `broadcastPreparedBrowserMint`; simulation does it earlier. But if `gasLimit` absent, ethers may populate/estimate during send depending on provider behavior |
| Simulation | Not in broadcast function; required earlier via status/checks |
| Calldata creation | No, created during `buildBrowserMintPlan`; calldata is decoded/reviewed during broadcast |
| Signer preparation | **Yes**, private key read + `new Wallet(...)` during broadcast |
| Signing | **Yes**, inside `wallet.sendTransaction(...)` |
| Raw transaction hash precompute | **No** |
| Burner 1 send + await, burner 2 send + await | Depends on caller. This function is one-row. Current UI likely loops rows; Phase 1 must replace any sequential loop with a scheduler |

## Added P0 development timing instrumentation

Implemented in `webapp/lib/browser-broadcast.ts` as an optional `timing` callback on `broadcastPreparedBrowserMint(...)`.

It uses monotonic high-resolution timing via `globalThis.performance.now()` with `Date.now()` fallback.

It emits secret-free events only:

- `txId`
- `stage`
- `elapsedMs`
- `deltaMs`
- `atMs`

It never logs private keys or raw signed transactions.

### Current timing event stages

```text
consent-received
consent-validated
signer-context-validated
calldata-binding-reviewed
provider-ready
rpc-chain-check-complete
authority-current-before-signing
signer-authority-consumed
wallet-object-created
send-transaction-start
send-transaction-response
broadcast-hash-validated
```

Conceptual trace format:

```text
consent-received: +0.000ms elapsed 0.000ms
rpc-chain-check-complete: +18.400ms elapsed 19.200ms
send-transaction-start: +0.300ms elapsed 20.000ms
send-transaction-response: +42.100ms elapsed 62.100ms
```

The `send-transaction-start → send-transaction-response` span currently includes ethers internal populate/sign/send work. Phase 1 should split this by adding a dedicated local `signPreparedBrowserMintTransaction(...)` stage that uses a fully populated transaction and computes the expected hash before broadcast.

Test coverage added:

- `webapp/lib/browser-broadcast.test.ts`
- Test: `broadcast emits a secret-free monotonic timing trace for the live hot path`
- Verifies stage order, finite timing, txId, and no private key leakage.

## Phase 1 implementation plan

### 1. Extend prepared transaction shape without weakening existing binding

Add a new low-latency prepared type, keeping the current Standard path intact initially.

Required fields:

- chainId
- to/contract
- SeaDrop/stage
- burner payer
- holder recipient
- calldata
- quantity
- value
- nonce
- gasLimit
- maxFeePerGas
- maxPriorityFeePerGas where relevant
- maximum total spend
- simulation result
- signer authority generation
- plan binding

The deterministic binding must include nonce + every fee/value/gas field.

### 2. Separate Prepare / Sign / Broadcast

Prepare:

- resolve chain/config;
- read SeaDrop/stage;
- build calldata;
- fetch nonce per burner;
- bind gas/fee fields;
- simulate;
- verify spend cap;
- produce `prepared` rows.

Sign:

- after explicit user consent;
- verify authority current;
- sign all independent burner transactions locally in browser memory;
- compute expected hash locally from raw signed tx;
- keep raw signed tx in memory only;
- never serialize raw signed tx into storage/report/journal/log/backend.

Broadcast:

- consume prepared signed envelopes;
- send raw signed txs through Standard RPC or Fast Relay;
- create submitted receipt evidence using expected hash;
- transition into existing receipt/recovery/Safe Finish path.

### 3. Generic concurrency scheduler

Implement a scheduler where:

- transactions from different burner addresses run concurrently;
- transactions from the same burner are ordered by nonce;
- max total rows remains 50;
- controlled global concurrency and per-route concurrency are configurable;
- no transaction mutation/replacement/gas bump is allowed.

### 4. Fast Relay service

Create separate service: `compas-fast-relay`.

Responsibilities:

- HTTPS API;
- authenticated raw-tx broadcast;
- multi-route same-hash race;
- warm keep-alive connections;
- health/latency metrics;
- optional later RAM-only Armed Launch.

Non-responsibilities:

- no signing;
- no key custody;
- no gas bump;
- no transaction replacement;
- no persistence of raw tx;
- no analytics/error body capture.

### 5. Multi-RPC race semantics

For each raw tx:

- browser sends expected hash;
- relay independently hashes raw tx and checks equality;
- relay submits same raw tx to configured routes;
- endpoint result can be `accepted`, `already-known`, `timeout`, `rate-limited`, `rejected`, `malformed`.

Aggregate:

- `ACCEPTED`: at least one endpoint returns expected hash or definite acceptance/already-known.
- `AMBIGUOUS`: no definite acceptance, but at least one route had timeout/connection ambiguity.
- `REJECTED`: all routes definitive rejection, no evidence of submission.

No auto retry with a different transaction.

### 6. Relay auth

Add Vercel API route for short-lived token issuance:

- validates existing Compas holder session;
- signs token with holder address, launchId, expiry, allowed chain, max tx count, purpose;
- browser obtains token during Prepare/Sign, not FIRE;
- browser stores token in memory only;
- relay verifies token.

### 7. Robinhood chain mode

Make `chainId = 4663` first-class for low-latency mode behind feature flags.

Config-driven routes:

- Robinhood Sequencer direct endpoint;
- Alchemy Robinhood RPC;
- QuickNode Robinhood RPC.

No frontend API secrets.

### 8. Benchmark CLI

Create deployable CLI for VPS testing:

- warmed measurements, hundreds of samples;
- p50/p90/p95/p99/min/max/jitter/error%/429%;
- DNS/TCP/TLS/request/response/total where measurable;
- JSON + table output;
- compare Frankfurt, Amsterdam, London, Paris, Madrid, Ashburn, NJ/NYC across AWS/Vultr/Hetzner/DigitalOcean.

Winner selected by stable p95/p99 and jitter, not lucky min.

## Phase 2: Armed Launch, after Phase 1 results

Only after normal low-latency relay broadcast is correct/tested:

- explicit `SIGN & ARM`;
- relay receives signed tx envelopes and manifest;
- RAM-only retention;
- short TTL;
- manual FIRE;
- scheduled FIRE;
- cancel;
- service restart drops material;
- UI communicates: relay cannot change tx, but can broadcast exact armed tx until expiry/cancel.

## Feature flags

- `LOW_LATENCY_BROADCAST`
- `MULTI_RPC`
- `ROBINHOOD_SEQUENCER`
- `ARMED_LAUNCH`

Enable order:

1. development/admin holder;
2. testnet;
3. controlled production;
4. mainnet only after benchmark + testnet E2E + security review.

## Phase 1 definition of done

- current hot path profiled;
- prepare/sign/broadcast separated;
- 50 independent burner tx can be pre-signed in browser memory;
- parallel broadcast implemented;
- Fast Relay working;
- multi-RPC same-hash race working;
- Robinhood Sequencer + Alchemy + QuickNode supported;
- relay auth working;
- no raw tx persistence/logging;
- current receipt/recovery/Safe Finish tests passing;
- new concurrency/race tests passing;
- benchmark CLI completed;
- real VPS region benchmark completed;
- testnet E2E completed;
- benchmark/results shown before Armed Launch.
