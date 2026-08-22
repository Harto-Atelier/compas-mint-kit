# OpenSea / Umi competitive polish backlog

## Implemented easy wins

- Keep safety visible in the mint path: `0 keys held`, `No sign`, `No tx`.
- Replace raw source strings with operator labels: `SeaDrop public`, `OpenSea signed`, `Preview fixture`, `OpenSea metadata`.
- Show all collection and stage warnings instead of only the first warning.
- Add a compact stage lifecycle rail: queued → live → close, with start/end copy.
- Add a local CLI dry-run command block with one-click copy beside RunConfig export.
- Tighten stage status copy: `Queued`, `Open now`, `Closed`, `Check timing`.

## Next low-risk polish

1. Add a one-screen post-export checklist: move JSON to repo root, load keys locally, dry-run, then explicit CLI confirmation.
2. Add per-stage `Local-ready` vs `Needs OpenSea signed data` badges beside quantity inputs.
3. Add a stage filter for `Live / Upcoming / Signed preview / Public` when more drops are compared.
4. Add persistent dismissible warnings for wallet-count and gas-ceiling guardrails.
5. Add export history in local storage: filename, collection, chain, stage count, wallet count.

## Larger product milestones

1. OpenSea collection importer parity: richer collection art, floor/context cards, and explicit primary-drop source labels.
2. Umi-style Disperse parity: sender/recipient CSV import, validation table, and disabled transaction review panel.
3. Execution boundary hardening: RunConfig schema version display, checksum, and CLI dry-run receipt copy-back.
4. Operator readiness mode: countdown, stage status refresh, RPC health input, and wallet balance dry-run handoff.

## Safety boundaries

- Browser remains planning-only.
- No private keys, signatures, calldata payloads, raw transactions, or broadcast endpoints in the webapp.
- Local CLI remains the only place where execution can ever happen, and config mode remains dry-run until a separately reviewed execution milestone exists.
