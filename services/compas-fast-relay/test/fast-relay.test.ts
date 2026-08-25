import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Wallet, keccak256 } from 'ethers';

import { loadConfig } from '../src/config';
import { createSafeLogger } from '../src/logger';
import { createServer } from '../src/server';
import type { RelayRouteClient } from '../src/routes';

const wallet = new Wallet('0x' + '11'.repeat(32));

async function signedRawTx(chainId = 8453): Promise<string> {
  return wallet.signTransaction({
    chainId,
    type: 2,
    to: '0x000000000000000000000000000000000000dEaD',
    value: 0n,
    nonce: 0,
    gasLimit: 21_000n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
  });
}

function postJson(port: number, path: string, body: unknown, origin = 'http://allowed.local') {
  const payload = JSON.stringify(body);
  return http(port, path, 'POST', payload, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload).toString(),
    origin,
  });
}

function http(port: number, path: string, method = 'GET', body = '', headers: Record<string, string> = {}): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ port, path, method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

type TestRelay = RelayRouteClient & { submitted: string[] };

function relay(id: string, responseHash = '0xproviderhash'): TestRelay {
  return {
    id,
    submitted: [],
    async broadcast(rawTx: string) {
      this.submitted.push(rawTx);
      return responseHash;
    },
  };
}

async function withServer(clients: RelayRouteClient[], options: Parameters<typeof createServer>[0]['config'] extends infer C ? Partial<C> : never) {
  const logLines: string[] = [];
  const logger = createSafeLogger('debug', (line) => logLines.push(line));
  const server = createServer({
    config: {
      port: 0,
      allowedOrigins: ['http://allowed.local'],
      chainAllowlist: [8453],
      maxRawBodyBytes: 4096,
      maxTxCount: 2,
      concurrency: 2,
      ttlSeconds: 5,
      logLevel: 'debug',
      routes: clients.map((client) => ({ id: client.id, type: 'injected' as const })),
      ...options,
    },
    routeClients: clients,
    logger,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo | null;
  assert.ok(address);
  return { server, port: address.port, logLines };
}

describe('Compas Fast Relay config', () => {
  it('loads route, origin, body, count, chain, concurrency, ttl, and log settings from environment', () => {
    const config = loadConfig({
      RELAY_PORT: '9001',
      RELAY_ALLOWED_ORIGINS: 'http://localhost:3000, https://mint.compas.example',
      RELAY_CHAIN_ALLOWLIST: '1,8453',
      RELAY_MAX_RAW_BODY_BYTES: '2048',
      RELAY_MAX_TX_COUNT: '3',
      RELAY_CONCURRENCY: '7',
      RELAY_TTL_SECONDS: '45',
      RELAY_LOG_LEVEL: 'debug',
      ROBINHOOD_SEQUENCER_URL: 'https://robinhood.example/rpc',
      ALCHEMY_RPC_URL: 'https://alchemy.example/rpc',
      QUICKNODE_RPC_URL: 'https://quicknode.example/rpc',
    });

    assert.equal(config.port, 9001);
    assert.deepEqual(config.allowedOrigins, ['http://localhost:3000', 'https://mint.compas.example']);
    assert.deepEqual(config.chainAllowlist, [1, 8453]);
    assert.equal(config.maxRawBodyBytes, 2048);
    assert.equal(config.maxTxCount, 3);
    assert.equal(config.concurrency, 7);
    assert.equal(config.ttlSeconds, 45);
    assert.equal(config.logLevel, 'debug');
    assert.deepEqual(config.routes.map((route) => route.id), ['robinhood-sequencer', 'alchemy', 'quicknode']);
  });
});

describe('Compas Fast Relay HTTP service', () => {
  it('serves health without exposing raw transaction data', async () => {
    const { server, port } = await withServer([relay('mock')], {});
    after(() => server.close());

    const res = await http(port, '/health');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true, service: 'compas-fast-relay', routes: 1 });
  });

  it('broadcasts only when the expected hash matches the raw signed transaction bytes', async () => {
    const rawTx = await signedRawTx();
    const expectedHash = keccak256(rawTx);
    const mock = relay('mock', expectedHash);
    const { server, port } = await withServer([mock], {});
    after(() => server.close());

    const res = await postJson(port, '/broadcast', {
      chainId: 8453,
      transactions: [{ rawTx, expectedHash }],
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['access-control-allow-origin'], 'http://allowed.local');
    assert.deepEqual(mock.submitted, [rawTx]);
    assert.deepEqual(JSON.parse(res.body), {
      ok: true,
      accepted: 1,
      results: [{ expectedHash, routeResults: [{ routeId: 'mock', ok: true, txHash: expectedHash }] }],
    });
  });

  it('rejects hash mismatches before any route sees raw bytes', async () => {
    const rawTx = await signedRawTx();
    const mock = relay('mock');
    const { server, port } = await withServer([mock], {});
    after(() => server.close());

    const res = await postJson(port, '/broadcast', {
      chainId: 8453,
      transactions: [{ rawTx, expectedHash: '0x' + '11'.repeat(32) }],
    });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(mock.submitted, []);
    assert.match(res.body, /expectedHash/);
    assert.doesNotMatch(res.body, new RegExp(rawTx.slice(2, 18), 'i'));
  });

  it('rejects signing material and unknown payload keys', async () => {
    const rawTx = await signedRawTx();
    const { server, port } = await withServer([relay('mock')], {});
    after(() => server.close());

    const res = await postJson(port, '/broadcast', {
      chainId: 8453,
      privateKey: wallet.privateKey,
      transactions: [{ rawTx, expectedHash: keccak256(rawTx) }],
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body, /signing material/i);
    assert.doesNotMatch(res.body, new RegExp(wallet.privateKey.slice(2, 18), 'i'));
  });

  it('enforces allowed origins, chain allowlist, body size limit, and max transaction count', async () => {
    const rawTx = await signedRawTx(1);
    const { server, port } = await withServer([relay('mock')], { maxRawBodyBytes: 64, maxTxCount: 1, chainAllowlist: [8453] });
    after(() => server.close());

    const forbidden = await postJson(port, '/broadcast', { chainId: 8453, transactions: [] }, 'http://evil.local');
    assert.equal(forbidden.statusCode, 403);

    const oversized = await postJson(port, '/broadcast', { chainId: 8453, transactions: [{ rawTx, expectedHash: keccak256(rawTx) }] });
    assert.equal(oversized.statusCode, 413);

    const other = await withServer([relay('mock')], { maxRawBodyBytes: 4096, maxTxCount: 1, chainAllowlist: [8453] });
    after(() => other.server.close());
    const disallowedChain = await postJson(other.port, '/broadcast', { chainId: 1, transactions: [{ rawTx, expectedHash: keccak256(rawTx) }] });
    assert.equal(disallowedChain.statusCode, 400);

    const tooManyRaw = await signedRawTx();
    const tooMany = await postJson(other.port, '/broadcast', { chainId: 8453, transactions: [
      { rawTx: tooManyRaw, expectedHash: keccak256(tooManyRaw) },
      { rawTx: tooManyRaw, expectedHash: keccak256(tooManyRaw) },
    ] });
    assert.equal(tooMany.statusCode, 400);
  });

  it('uses a safe logger and never writes raw transaction bodies to logs', async () => {
    const rawTx = await signedRawTx();
    const expectedHash = keccak256(rawTx);
    const failing: RelayRouteClient = {
      id: 'failing',
      async broadcast() {
        throw new Error(`provider rejected ${rawTx}`);
      },
    };
    const { server, port, logLines } = await withServer([failing], {});
    after(() => server.close());

    const res = await postJson(port, '/broadcast', { chainId: 8453, transactions: [{ rawTx, expectedHash }] });
    assert.equal(res.statusCode, 502);
    assert.equal(logLines.length > 0, true);
    assert.doesNotMatch(logLines.join('\n'), new RegExp(rawTx.slice(2, 34), 'i'));
    assert.match(logLines.join('\n'), /\[redacted-raw-tx\]/);
  });
});
