# Low-Latency Phase 1 Integration Plan

Base: `95fe851` (`docs(webapp): profile browser mint hot path`).

Goal: merge the parallel low-latency lanes into one coherent Phase 1 while preserving the existing security boundary: browser-only keys/signing, no backend key custody, no raw transaction persistence/logging, explicit holder consent, receipt/recovery/Safe Finish continuity, and no automatic replacement/gas-bump behavior.

## Current merge reality

The local low-latency worktrees/branches inspected for this plan are clean and all currently point at `95fe851`:

- `/tmp/compas-ll-sign` / `feat/phase1-browser-prepare-sign`
- `/tmp/compas-ll-scheduler` / `feat/ll-scheduler`
- `/tmp/compas-ll-relay` / `feat/fast-relay-service`
- `/tmp/compas-ll-auth` / `feat/ll-auth`
- `/tmp/compas-ll-robinhood` / `feat/robinhood-low-latency`
- `/tmp/compas-ll-benchmark` / `feat/ll-benchmark`
- `/tmp/compas-ll-race` / `feat/ll-race`

So the actual integration should be a planned, path-scoped merge rather than a blind branch merge. The only shared starting diff already in the base is `docs/low-latency-mint-architecture.md` plus timing instrumentation/tests in `webapp/lib/browser-broadcast.ts` and `webapp/lib/browser-broadcast.test.ts`.

## Canonical Phase 1 boundaries

| Lane | Canonical owner paths | Must export | Must not do |
| --- | --- | --- | --- |
| Shared low-latency model | `webapp/lib/low-latency-mint-types.ts` (new) and narrow additions to `webapp/lib/browser-broadcast.ts` | Versioned prepared/signed/broadcast envelope types; serializable public metadata; in-memory-only raw tx holder type | Duplicate shape definitions in UI/relay/scheduler files |
| Browser prepare/sign primitives | `webapp/lib/browser-broadcast.ts`, `webapp/lib/browser-broadcast.test.ts` | `prepareLowLatencyBrowserMintRows(...)`, `signPreparedBrowserMintTransaction(...)`, expected hash from raw signed tx | Signing inside `broadcastPreparedBrowserMint(...)`; raw tx in reports/localStorage/API payloads |
| Browser scheduler | `webapp/lib/low-latency-scheduler.ts` + `.test.ts` | Concurrency plan that preserves per-wallet nonce order and caps rows at 50 | Cross-wallet serial loop; mutation/replacement/retry with different calldata/gas |
| Relay client + same-hash race semantics | `webapp/lib/low-latency-relay-client.ts` + `.test.ts`; optionally reuse root `src/rpc-blast.ts` concepts | `accepted` / `ambiguous` / `rejected` classification; expected-hash verification | Treating timeouts as definite rejection; logging raw tx or provider credential URLs |
| Fast relay service | Prefer isolated package `services/compas-fast-relay/**` | HTTPS raw-tx endpoint, health, metrics, per-route fanout, no-store logging policy | Touching Next holder auth/session cookies directly; persisting raw txs; signing |
| Relay token issuance/auth | `webapp/lib/low-latency-relay-auth.ts`, `webapp/app/api/low-latency/relay-token/route.ts` | Short-lived HMAC/JWT-like token bound to holder session, launch, chain, tx count, purpose, expiry | Long-lived bearer tokens; token issuance during FIRE; exposing relay secrets client-side |
| Robinhood config | `src/chains.ts`, `webapp/lib/chains.ts`, `webapp/lib/browser-broadcast.ts`, `.env.example`, chain tests | Chain ID `4663`, explorer, route labels, env-driven SeaDrop/RPC config | Assuming a SeaDrop singleton without `SEADROP_ADDRESS_ROBINHOOD`; frontend API secrets |
| Benchmark | `scripts/` or `src/low-latency-benchmark.ts` + docs output template | p50/p90/p95/p99/jitter/error/429 table + JSON; warmed samples; region/provider comparison | Picking a route by lucky min latency; sending real signed txs in benchmark |
| UI | `webapp/app/components/BrowserBroadcastPanel.tsx`, `GuidedHolderFlow.tsx`, focused UI tests | Prepare -> Sign -> Broadcast separation; explicit consent; signed-in-memory count; relay status | New execution button that bypasses current simulation/receipt/recovery gates |

## Minimal merge strategy

1. **Create one clean integration worktree from `95fe851`.** Do not integrate in the canonical checkout and do not push/deploy. Keep commits small and path-scoped.
2. **Land the shared model first.** Add one canonical `low-latency-mint-types.ts` and import it from all lanes. This avoids the common conflict where UI, scheduler, and relay each invent their own `PreparedTx` / `SignedTx` shape.
3. **Rebase/copy each lane by allow-listed paths only.** Do not `git merge` the whole agent branches. Copy only the lane-owned paths above, then manually adapt imports to the shared model.
4. **Keep the existing standard path intact.** `broadcastPreparedBrowserMint(...)` remains the compatibility path until the new Phase 1 path is green. Low-latency code should be feature-flagged behind `LOW_LATENCY_BROADCAST`/`NEXT_PUBLIC_LOW_LATENCY_BROADCAST` and must default off.
5. **Commit in dependency order.** Suggested local commits:
   1. shared model + deterministic binding expansion tests;
   2. browser prepare/sign primitives;
   3. scheduler pure library;
   4. relay race classification/client;
   5. relay auth token API;
   6. Robinhood config unification;
   7. UI wiring behind flags;
   8. benchmark CLI/docs;
   9. optional isolated Fast Relay service package.
6. **After each commit, run the smallest relevant targeted test, then periodically run the broad gates.** Never accumulate all lanes before first verification.

## Integration order and gates

### 0. Baseline protection

- Record `git status --short --branch`, `git rev-parse HEAD`, and `git worktree list`.
- Confirm no low-latency branch has uncommitted work before copying from it.
- Run baseline gates if dependencies are installed:
  - root: `npm test` and `npm run build`
  - webapp: `npm test`, `npm run lint`, `npm run build`

If baseline is red, capture exact pre-existing failures and continue with targeted gates only for changed paths.

### 1. Shared low-latency model

Add canonical versioned types for:

- `LowLatencyPreparedMintRow`: includes chain, to, data, value, nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas, stage, payer, recipient, simulation evidence, plan binding, signer authority generation.
- `LowLatencySignedMintEnvelope`: in-memory raw signed tx plus expected hash and public metadata. The raw tx type should be intentionally hard to serialize (for example, non-enumerable field or closure-backed holder).
- `LowLatencyBroadcastResult`: `accepted | ambiguous | rejected`, route-level outcomes, expected hash, timing only.

Gate:

```bash
cd webapp
npx tsx --test lib/browser-broadcast.test.ts
```

Add tests proving nonce and every gas/fee/value field affect the deterministic binding and that JSON serialization never includes private keys or raw signed transactions.

### 2. Browser prepare/sign primitives

Extend `webapp/lib/browser-broadcast.ts` without removing current behavior:

- move nonce/fee/gas population into Prepare;
- require simulation before Sign;
- locally sign via `wallet.signTransaction(...)`, not `wallet.sendTransaction(...)`;
- compute expected hash from raw signed tx before any network send;
- consume signer authority once and mark the original row non-reusable;
- keep raw signed tx in memory only.

Conflict risk: this file is the hottest conflict surface. Prefer small patches around `BrowserPreparedMintRequest`, binding creation, `simulatePreparedBrowserMint(...)`, and a new `signPreparedBrowserMintTransaction(...)` export. Do not rewrite receipt helpers.

Gates:

```bash
cd webapp
npx tsx --test lib/browser-broadcast.test.ts lib/guided-holder-recovery.test.ts lib/guided-holder-journey.test.ts
npm run lint -- lib/browser-broadcast.ts lib/browser-broadcast.test.ts
```

If the lint script ignores file filters, use `npx eslint <files>` directly.

### 3. Browser scheduler

Add a pure scheduler library before UI wiring:

- accepts signed envelopes and a per-route concurrency config;
- permits concurrency across distinct payer addresses;
- preserves nonce order for the same payer;
- has a hard max of 50 rows;
- never mutates transaction fields or synthesizes replacements.

Do not reuse root `src/execution-scheduler.ts` directly for browser Phase 1 if that would inherit CLI-only dry-run assumptions (`keyMaterialLoaded: false`, no browser keys). Reuse concepts/tests, not the type surface, unless it is first generalized.

Gates:

```bash
cd webapp
npx tsx --test lib/low-latency-scheduler.test.ts
npm run test
```

### 4. Same-hash race and relay client

Build route classification as a pure library before network/UI work:

- each route submits the same raw signed tx;
- local expected hash must equal locally/relay-computed hash;
- `already known` / expected hash result is acceptance;
- timeout/connection reset after send is ambiguous, not rejected;
- only all definite rejections produce rejected;
- no auto retry with a different transaction.

Gates:

```bash
cd webapp
npx tsx --test lib/low-latency-relay-client.test.ts
npm run test
```

Security scan after this lane:

```bash
git grep -nE 'console\.(log|warn|error).*raw|rawTransaction|signedTx|privateKey' -- webapp src services || true
git grep -nE 'localStorage|sessionStorage|indexedDB' -- webapp/lib webapp/app | grep -E 'raw|signed|private|key|tx' || true
```

Every hit must be inspected; the acceptable result is no persistence/logging of raw tx or private key material.

### 5. Relay token issuance/auth

Add a narrow Next API route that depends on the existing Compas session cookie. Token issuance rules:

- holder session must be valid via `readSessionCookie(...)`;
- token contains holder address, launch ID, chain ID/key, max tx count, purpose (`low-latency-relay`), issued-at, expiry;
- TTL should be minutes, not hours;
- token fetched during Prepare/Sign, not FIRE;
- relay secret remains server-only (`LOW_LATENCY_RELAY_TOKEN_SECRET` or derived from existing server secret); no `NEXT_PUBLIC_` secret names.

Conflict risk: `webapp/lib/compas-auth.ts` already provides generic signed payload helpers. Reuse them if possible, but keep relay-token type validation separate so holder session cookies and relay tokens cannot be confused.

Gates:

```bash
cd webapp
npx tsx --test lib/compas-auth.test.ts lib/low-latency-relay-auth.test.ts
npm run build
```

### 6. Robinhood config unification

Unify chain config across root CLI and webapp:

- root `src/chains.ts` already has `robinhood` chain ID `4663`, explorer, and env-driven SeaDrop override;
- webapp `browserChainConfig(...)` already gates Robinhood on explicit RPC + SeaDrop singleton;
- add low-latency route config as env-only (`ROBINHOOD_*_RPC`, `LOW_LATENCY_ROBINHOOD_*`) and never expose provider API keys in browser bundles;
- keep `SEADROP_ADDRESS_ROBINHOOD` mandatory for executable calldata.

Conflict risk: adding a default Robinhood SeaDrop address in one lane would silently remove the current fail-closed guard. Reject that unless a verified deployment is documented and tested.

Gates:

```bash
node --test -r ts-node/register test/chains.test.ts test/security-boundary.test.ts
cd webapp
npx tsx --test lib/browser-broadcast.test.ts
```

### 7. UI wiring

Only after libraries are green, wire the UI behind flags:

- show separate Prepare, Sign, and Broadcast states;
- display timing trace and expected hashes, but never raw signed tx;
- require explicit confirmation matching the current binding;
- preserve existing receipt/recovery/Safe Finish components;
- disable relay mode unless token + config + signed envelopes are present;
- show ambiguous relay results as reconciliation-needed, not failed/retryable.

Conflict risk: UI components currently consume `BrowserPreparedMint` and existing statuses. Avoid widening `BrowserMintStatus` until tests for report summaries and terminal-state helpers are updated. Prefer a separate low-latency state object layered over existing rows.

Gates:

```bash
cd webapp
npx tsx --test lib/browser-broadcast-ui.test.ts lib/guided-holder-flow-ui.test.ts lib/guided-holder-flow.test.ts
npm run build
```

### 8. Benchmark CLI/docs

Benchmark should be independent from live mint execution:

- no private keys;
- no raw signed transaction input;
- POST only harmless JSON-RPC methods where supported (`eth_chainId`, `eth_blockNumber`) or explicit dry probes;
- report warmed p50/p90/p95/p99/min/max/jitter/error%/429%;
- record region/provider and sample count;
- choose route by p95/p99/jitter stability, not min.

Gates:

```bash
npm run build
node dist/<benchmark-entry>.js --help
node dist/<benchmark-entry>.js --dry-run --json
```

### 9. Fast Relay service package

Integrate as a separate package/service so it cannot accidentally import browser auth/session internals:

- endpoint accepts `{ rawTx, expectedHash, chainId, launchId }` plus bearer token;
- computes hash server-side and rejects mismatch;
- fans out to configured endpoints with keep-alive;
- redacts raw tx, provider URL credentials, 64-hex material from all logs/errors;
- no disk/db persistence of raw tx or request body;
- health endpoint exposes route labels and timing, not secrets.

Gates:

```bash
cd services/compas-fast-relay
npm test
npm run build
```

If the service shares repo dependencies, also rerun root/webapp gates after package integration.

## Highest conflict/security risks

1. **`webapp/lib/browser-broadcast.ts` shape drift.** Many tests and UI helpers depend on `BrowserPreparedMint`, status values, report serialization, signer `WeakMap`, and receipt reconciliation. Add low-latency types alongside current types first; only migrate callers after tests are green.
2. **Raw signed transaction leakage.** The biggest new secret-adjacent material is the raw signed tx. It must never appear in JSON reports, localStorage/sessionStorage/IndexedDB, server logs, analytics, screenshots, or error bodies.
3. **Consent binding bypass.** New Sign and Broadcast steps must bind nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas, value, chain, calldata, payer, recipient, stage, and max spend. UI confirmation must reference this binding.
4. **Ambiguous relay results misclassified as safe failures.** A timeout after submit may still land onchain. Existing Safe Finish/reconciliation should handle it; do not auto-send a replacement or duplicate.
5. **Robinhood fail-closed guard erosion.** Keep Robinhood executable paths disabled until both RPC and verified SeaDrop address are operator supplied. Do not treat the public RPC as proof of SeaDrop compatibility.
6. **Root CLI/webapp duplicate registries.** `src/chains.ts`, `webapp/lib/chains.ts`, and `browserChainConfig(...)` can drift. Integration should either share generated constants or add tests that assert equal chain IDs/explorers for supported chains.
7. **Feature flag mismatch.** Server `LOW_LATENCY_BROADCAST` and client `NEXT_PUBLIC_LOW_LATENCY_BROADCAST` should both default off. Production must not expose new broadcast/relay UI by a stale public flag alone.
8. **Relay auth token confusion.** Holder session cookie != relay token. Relay token must have a narrow audience/purpose and short TTL.
9. **Benchmark dependency creep.** Benchmark code should not become a production dependency of the webapp bundle or relay hot path.

## Final verification bundle before Phase 1 handoff

Run from a clean integration worktree after all lanes are merged:

```bash
# Repository hygiene
git status --short --branch
git diff --check
git grep -nE 'console\.(log|warn|error).*raw|rawTransaction|signedTx|privateKey' -- webapp src services || true
git grep -nE 'localStorage|sessionStorage|indexedDB' -- webapp/lib webapp/app | grep -E 'raw|signed|private|key|tx' || true

# Root CLI gates
npm test
npm run build

# Webapp gates
cd webapp
npm test
npm run lint
npm run build

# Focused low-latency gates (names may expand as files land)
npx tsx --test \
  lib/browser-broadcast.test.ts \
  lib/low-latency-scheduler.test.ts \
  lib/low-latency-relay-client.test.ts \
  lib/low-latency-relay-auth.test.ts \
  lib/guided-holder-recovery.test.ts \
  lib/guided-holder-journey.test.ts
```

Manual/local smoke before any preview deploy:

1. Prepare 2-3 test rows with fake/provider-stubbed low-latency mode: all rows should become prepared with nonce/fee/gas bound.
2. Sign in browser memory: expected hashes visible, raw tx never visible in UI/report/devtools storage.
3. Standard RPC broadcast path with a stub provider: accepted hash becomes a submitted receipt.
4. Relay path against local relay stub: accepted, ambiguous, and rejected classifications render correctly.
5. Vault authority change after signing marks already submitted hashes for reconciliation and never rebroadcasts.
6. Robinhood without `SEADROP_ADDRESS_ROBINHOOD` remains blocked; with stub env config it resolves chain ID `4663` and labels routes without exposing provider secrets.

## Phase 1 stop line

Phase 1 is complete only when:

- existing browser vault, broadcast, receipt, recovery, auth, root security, and scheduler tests still pass;
- new prepare/sign/scheduler/relay/auth/Robinhood/benchmark tests pass;
- no raw tx/private key persistence/logging scan remains unexplained;
- benchmark output exists for candidate VPS regions/routes;
- testnet E2E proves expected-hash -> submitted-receipt -> Safe Finish reconciliation;
- Armed Launch remains unmerged/disabled until a separate Phase 2 security review.
