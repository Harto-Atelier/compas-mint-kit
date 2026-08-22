# Launch key security: encrypted vault mode and rotation

Use this as the operator handoff for launch wallets that may hold real mint funds.
It documents the safe boundary for encrypted launch vault mode, Vercel-hosted
risk, launch key rotation, encrypted JSON backup/restore, and funded canaries.

## Implementation boundary

There are two different surfaces. Do not blur them:

1. **Hosted/default planner** — planning, stage review, wallet-count modelling,
   and no-secret JSON export. It must not receive private keys, seed phrases,
   signed transactions, wallet JSON, RPC secrets, cookies, or bearer tokens.
2. **Local encrypted vault mode** — an operator-only mode for a local/self-hosted
   browser or local CLI workflow where short-lived hot-wallet keys are encrypted
   at rest and unlocked only on the operator machine immediately before launch.

The current repo has local vault crypto helpers under `webapp/lib/launch-vault.ts`:

- encrypted backup kind: `compas-launch-vault`;
- browser storage key: `compas-launch-vault:v1`;
- cipher: AES-GCM;
- KDF: PBKDF2-SHA256;
- iterations: `250000`;
- plaintext payload while unlocked: launch id/name/timestamps plus wallet labels,
  chains, addresses, and private keys.

Root CLI boundaries still apply:

- `npm run dev -- plan` is dry-run/no-broadcast. Its `--broadcast` path currently
  validates architecture gates and re-reads the stage, but still stops before
  signing/broadcasting.
- `npm run dev -- canary` can broadcast exactly one guarded public SeaDrop canary
  only with `--broadcast-confirm I_APPROVE_FUNDED_CANARY`.
- The interactive root CLI live path asks for keys locally and broadcasts only
  after the final `Fire?` confirmation.

Encrypted vault mode is **not a Vercel feature**. Use it only on a trusted local
or private self-hosted operator surface.

## Threat model

### Assets to protect

- Hot-wallet private keys and seed material.
- Funded balances temporarily staged for a launch.
- Vault passphrases and unlocked in-memory wallet payloads.
- Encrypted backup JSON files and any plaintext temp files created during export,
  restore, or CLI bridging.
- RPC provider URLs/API keys if they reveal quotas, project identity, or private
  infrastructure.
- Launch timing, wallet aliases, target contract, run config, canary txs, and
  post-launch sweep records.

### Threats in scope

- A compromised or misconfigured Vercel deployment, including preview deploys,
  serverless runtime logs, build logs, team/admin access, environment variable
  access, or dependency/build-step exfiltration.
- Browser compromise: malicious extensions, injected scripts, shared-screen leaks,
  pasted secrets into the wrong field, remote web console changes, browser sync,
  localStorage/session restore, or devtools exposure.
- Shell and workstation leakage: shell history, process listings, terminal scroll
  back, crash logs, swap/sleep images, cloud desktop backup, and screenshots.
- Repository leakage: accidentally committing `.env`, `wallets/`, raw keys,
  decrypted vault JSON, encrypted backups meant to stay offline, or run outputs
  that include secrets.
- Operational errors: wrong chain, wrong contract, public RPC degradation,
  overfunded hot wallets, reused launch keys, stale run configs, and missing
  post-launch sweep.

### Out of scope / not solved by this kit

- Malware, a hostile browser extension, or a hostile admin on the operator machine
  after the vault is unlocked.
- A compromised dependency, RPC provider, or browser runtime at the exact
  signing/broadcast moment.
- Theft from wallets that stay funded after the launch.
- Hardware-wallet custody design for treasury funds.

Treat encrypted vault mode as reducing **at-rest and cloud exposure**, not as a
replacement for a clean local machine, short-lived hot wallets, and strict
funding caps.

## Vercel-hosted risk

Vercel is acceptable for a public/planning-only console, but it is the wrong trust
boundary for funded launch keys or unlocked vaults.

Do not put any of these in Vercel project settings, preview env vars, build-time
env vars, server actions, API routes, browser localStorage on a Vercel origin, or
`NEXT_PUBLIC_*` variables:

- private keys, mnemonics, encrypted vault passphrases, wallet JSON, or seed
  backups;
- unlocked vault payloads, raw signed transactions, or signatures;
- private RPC URLs/API keys intended only for local launch execution;
- session cookies, OpenSea auth, bearer tokens, or allowlist signer material.

If the planner is hosted on Vercel, use it only to export non-secret planning
data: chain, contract, selected stage, quantities, wallet count, timing, gas
assumptions, optional destination labels, and warnings. Move that reviewed plan
to a local CLI or local vault run.

For large funded keys, use a local/self-hosted planner and a local CLI on a
machine you control. Do not rely on a cloud-hosted app to protect secrets it never
needed to see.

## Recommended deployment modes

| Mode | When to use | Key rule |
| --- | --- | --- |
| Vercel planner + local CLI | Public review, lightweight planning, unfunded address-only previews. | Vercel receives no keys, vaults, passphrases, private RPCs, or broadcasts. |
| Local Next.js planner + local CLI | Normal launch prep with funded hot wallets. | Run `webapp` on `localhost`; keep keys local and export only needed CLI env vars. |
| Local encrypted browser vault | Operator-only browser launch workflow. | Use a clean local/self-hosted origin; passphrase unlocks keys into browser memory only for the launch. |
| Self-hosted private planner | Team launch room or dedicated launch host. | Private network, locked team access, no Vercel, no public origin, no cloud logs. |
| Offline/isolated signing host | Large funded keys or high-value drops. | Generate/hold hot keys locally, fund just-in-time, broadcast from controlled CLI. |

For large funded keys, prefer fresh hot wallets funded only with the maximum spend
cap plus gas buffer. Keep treasury/cold funds behind separate hardware custody.

## Encrypted launch vault mode

Use encrypted JSON for operator backup/restore of **short-lived hot wallets**.
There are two compatible operating patterns:

1. **Browser vault backup** from local encrypted vault mode. This is the preferred
   shape for the webapp vault helpers.
2. **CLI-compatible offline vault** for operators who need to bridge decrypted keys
   into root CLI environment variables.

Both patterns must stay local/offline. Neither belongs in git, Vercel, issue
trackers, chat, or browser uploads.

### Browser vault encrypted backup JSON

The browser vault helper encrypts a payload with AES-GCM and serializes only the
metadata plus ciphertext. The encrypted backup shape is:

```json
{
  "kind": "compas-launch-vault",
  "header": {
    "version": 1,
    "cipher": "AES-GCM",
    "kdf": "PBKDF2-SHA256",
    "iterations": 250000,
    "salt": "base64-salt",
    "iv": "base64-iv",
    "createdAt": 1787356800000,
    "updatedAt": 1787356800000
  },
  "ciphertext": "base64-ciphertext"
}
```

The decrypted payload contains the launch metadata and wallet private keys. While
the vault is locked, private keys should exist only inside ciphertext. While it is
unlocked, private keys exist in browser memory and the browser becomes part of the
signing trust boundary.

Rules:

- Create, unlock, backup, and restore browser vaults only on a trusted local or
  private self-hosted origin.
- Do not unlock a funded vault on a public/Vercel origin, shared browser profile,
  synced browser profile, or machine with untrusted extensions.
- Export an encrypted backup immediately after creating/rotating keys, store it
  offline, then lock/wipe local browser state when the launch is complete.
- Treat passphrase disclosure as complete compromise of every wallet in that
  encrypted backup.

### CLI-compatible offline vault JSON

For root CLI commands that expect env vars, keep a plaintext JSON only long enough
to encrypt it under `wallets/` (git-ignored):

```json
{
  "schema": "compas.launch-vault.v1",
  "launch": "example-drop-2026-08",
  "chain": "base",
  "createdAt": "2026-08-22T00:00:00.000Z",
  "rotation": "fresh-hot-wallets-for-this-launch-only",
  "wallets": [
    {
      "alias": "canary",
      "envVar": "CANARY_WALLET_KEY",
      "address": "0xCanaryAddress",
      "privateKey": "0x..."
    },
    {
      "alias": "hot-1",
      "envVar": "HOT_WALLET_1",
      "address": "0xHotWallet1",
      "privateKey": "0x..."
    }
  ]
}
```

Create/update the encrypted backup:

```bash
mkdir -p wallets
$EDITOR wallets/launch-vault.json
jq -e '.schema == "compas.launch-vault.v1" and (.wallets | length > 0)' wallets/launch-vault.json

openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 \
  -in wallets/launch-vault.json \
  -out wallets/launch-vault.enc.json

shasum -a 256 wallets/launch-vault.enc.json > wallets/launch-vault.enc.json.sha256
rm -f wallets/launch-vault.json
```

`openssl enc` prompts for the vault passphrase. Use a unique high-entropy
passphrase stored outside this repo, preferably in a password manager or offline
launch packet. This OpenSSL fallback is for local-at-rest protection; it does not
replace fresh-wallet rotation or a clean signing machine.

### Restore a CLI vault for a local run

Decrypt to a temporary file, export only the env vars needed for the command, then
remove the plaintext:

```bash
umask 077
tmp_vault="$(mktemp /tmp/compas-launch-vault.XXXXXX.json)"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in wallets/launch-vault.enc.json \
  -out "$tmp_vault"

while IFS=$'\t' read -r env_var private_key; do
  export "$env_var=$private_key"
done < <(jq -r '.wallets[] | [.envVar, .privateKey] | @tsv' "$tmp_vault")

rm -f "$tmp_vault"
```

Run restore commands in `bash` or `zsh`; process substitution keeps the exports
in the current shell. Keep the terminal session private. Close the shell after
the launch so exported keys leave the environment. Do not use `env`, `set`, shell
debug mode (`set -x`), or command wrappers that print environment variables while
keys are loaded.

### Restore only the canary key

For a canary, do not export the full launch wallet set:

```bash
umask 077
tmp_vault="$(mktemp /tmp/compas-launch-vault.XXXXXX.json)"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in wallets/launch-vault.enc.json \
  -out "$tmp_vault"

export CANARY_WALLET_KEY="$(jq -r '.wallets[] | select(.alias == "canary") | .privateKey' "$tmp_vault")"
rm -f "$tmp_vault"
```

Then run the funded canary command from [`funded-canary-runbook.md`](./funded-canary-runbook.md).

## Launch key rotation process

### Before launch

1. Generate fresh hot wallets on the local operator machine. Do not reuse keys
   from a previous launch, testnet run, demo, or compromised workstation.
2. Record aliases, expected addresses, chain, launch name, and max spend cap in
   the local vault.
3. Export an encrypted backup, verify it can be restored locally, and delete any
   plaintext scratch files.
4. Use address-only env vars for early dry-runs whenever possible:

   ```bash
   export HOT_WALLET_1=0xExpectedHotWallet1
   npm run dev -- plan \
     --chain base \
     --contract 0xYourNftContract \
     --wallet hot-1=HOT_WALLET_1 \
     --quantity 1 \
     --concurrency 1
   ```

5. Fund hot wallets just-in-time from treasury/cold custody with only the launch
   cap plus gas buffer. Keep the canary wallet separately capped.
6. Re-run dry-runs after every chain, contract, quantity, gas, RPC, or wallet
   change.

### During launch

1. Unlock/decrypt only on the local operator machine.
2. Export only the env vars or unlock only the browser wallets required for the
   immediate command.
3. Verify chain ID, contract, SeaDrop address, wallet addresses, balances, gas
   ceiling, and spend cap in CLI/browser output before approving any broadcast.
4. Keep any hosted planner advisory; do not paste keys or passphrases into it.

### After launch

1. Save tx hashes, explorer links, and final balances.
2. Sweep remaining funds from every hot wallet to cold custody or a designated
   post-launch wallet.
3. Lock the browser vault and close any shell session that held private-key env
   vars.
4. Delete plaintext temp files and local run scratch files.
5. Archive the encrypted vault and checksum offline only if needed for audit;
   otherwise destroy it after confirming all balances are swept.
6. Mark the launch keys retired. Never reuse them.

### Emergency rotation triggers

Rotate immediately if any of these occur:

- a private key, passphrase, plaintext vault, unlocked payload, or env dump
  appears in terminal output, logs, browser fields, chat, docs, git, or cloud
  storage;
- keys or passphrases were ever added to Vercel or any hosted web app;
- the operator machine, browser profile, dependency install, or RPC endpoint is
  suspected compromised;
- a hot wallet is overfunded or funded on the wrong chain;
- canary behavior differs from the dry-run plan.

Emergency response: stop broadcasts, sweep remaining funds with a clean machine
if possible, generate fresh hot wallets, create a new encrypted vault, update
address-only plans, and repeat the funded canary.

## Canary procedure

Use canary runs to validate the exact launch boundary before scaling wallet count.

1. Pick one dedicated canary wallet and cap it to the amount you are willing to
   lose in a single test.
2. Run the canary dry-run with a public address first. It should print
   `STOPPED BEFORE BROADCAST — dry-run/no-broadcast is the default.`
3. If the dry-run is clean, unlock/export only the canary key and rerun with
   `--broadcast-confirm I_APPROVE_FUNDED_CANARY`.
4. Verify the tx hash, receipt, minted token ownership, final balance, and gas
   paid independently on the explorer.
5. If any input changes after the canary — chain, contract, stage, RPC, quantity,
   gas cap, wallet set, or funding source — repeat dry-run and canary before the
   larger wave.
6. If the canary fails unexpectedly or reveals a mismatch, retire that canary key,
   rotate the vault, and do not scale up until the mismatch is understood.

See [`funded-canary-runbook.md`](./funded-canary-runbook.md) for exact CLI
commands and abort conditions.
