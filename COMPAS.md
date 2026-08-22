# Compas · Mint Sniper Kit

`compas-mint-kit` is the [Harto Atelier](https://harto.es) fork of
[morsyxbt/nft-public-mint](https://github.com/morsyxbt/nft-public-mint), packaged
as a small utility perk for **[Compas by Harto](https://opensea.io/collection/compas-by-harto)**
holders.

## What it is

An open-source CLI that snipes **public** OpenSea SeaDrop mints from on-chain
data — no OpenSea login, no API key required for the mint itself, no rate
limits. You paste one or more private keys, and every transaction is signed
and serialised *before* the stage opens so the only work left at the drop
moment is writing bytes to the network.

Read the upstream [README](./README.md) for the full mechanics — nothing in the
sniper itself has changed. This fork exists to bundle Compa-friendly defaults
and documentation.

## Web console + local execution model

The mint kit now has two explicit lanes:

- **Plan in the web console.** The Next.js app in [`webapp/`](./webapp) is an
  operator planner for collection discovery, stage review, wallet-wave sizing,
  gas assumptions, and schedule warnings. It supports the same chains as the CLI:
  **Ethereum**, **Base**, and **Robinhood Chain**.
- **Keep keys out of the browser.** The console is no-custody by design: no
  private keys, seed phrases, wallet signatures, or transaction broadcasts in
  browser state or API payloads.
- **Keep hosted env empty of execution secrets.** The web console should not need
  Vercel secrets; never expose wallet keys, signer material, or private RPC URLs
  through `NEXT_PUBLIC_*`.
- **Export a run config.** Planner output is a handoff file for the local
  executor: chain, collection address, selected stages, quantities, wallet count,
  gas limit/max fee, fire time, optional sweep-destination label, and warnings. It is not a
  wallet file and must not contain secrets.
- **Dry-run locally.** Bring the run config to the root CLI, enter hot-wallet keys
  only in the terminal, and run the local checks before committing to a mint. With
  today's interactive CLI, the safe dry-run equivalent is to follow the wizard to
  the final summary and answer `n` at `Fire?`.
- **Broadcast remains local.** The web console should never grow a mainnet
  broadcast button. Future config-driven broadcast support belongs in the local
  CLI only, after an explicit operator confirmation.

## Which chains work

The same three chains as upstream:

- **Ethereum** mainnet
- **Base**
- **Robinhood Chain**

If you're a Compa holder and you already have an Alchemy key from the Compas
utility surfaces (portfolio, terminal, dashboard), you can reuse the same key
here — see [`.env.example`](./.env.example) for the variable names.

## Compa holder courtesy — read this

**Holding a Compa is not enforced by this tool.** The code does not read your
wallet, does not check ownership, does not phone home. Anyone can clone this
fork and run it.

Compa-holder access here is a **courtesy convention**, not a technical restriction:

- We surface this fork as a Compa-holder perk in the collector dashboard.
- The upstream project is MIT-style open source and stays that way in the fork.
- If you're not a Compa holder, please use the upstream repo directly and
  give [@morsyxbt](https://github.com/morsyxbt) the star.

## Credits

- Upstream author and all sniping logic: **[@morsyxbt](https://github.com/morsyxbt)**
  — [morsyxbt/nft-public-mint](https://github.com/morsyxbt/nft-public-mint).
- Fork maintenance and Compa integration: **[Harto Atelier](https://harto.es)**.

## Links

- Compas collection: <https://opensea.io/collection/compas-by-harto>
- Upstream sniper: <https://github.com/morsyxbt/nft-public-mint>
- This fork: <https://github.com/Harto-Atelier/compas-mint-kit>
