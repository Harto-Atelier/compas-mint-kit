# Compas Fast Relay

Standalone skeleton service for transporting **already-signed raw transactions only**. It never accepts private keys, seed phrases, unsigned transaction plans, or signing material.

## Endpoints

- `GET /health` — process health and route count.
- `POST /broadcast` — validates supplied raw signed transaction hashes and forwards raw bytes to configured route clients.

## Environment

```bash
RELAY_PORT=8787
RELAY_ALLOWED_ORIGINS=http://localhost:3000,https://example.com
RELAY_CHAIN_ALLOWLIST=1,8453,999
RELAY_MAX_RAW_BODY_BYTES=65536
RELAY_MAX_TX_COUNT=10
RELAY_CONCURRENCY=4
RELAY_TTL_SECONDS=30
RELAY_LOG_LEVEL=info
ROBINHOOD_SEQUENCER_URL=https://...
ALCHEMY_RPC_URL=https://...
QUICKNODE_RPC_URL=https://...
```

## Scripts

```bash
npm run build
npm test
npm start
```

From the repository root:

```bash
npm run relay:build
npm run relay:test
```
