import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { RelayConfig } from './config';
import { createSafeLogger, type SafeLogger } from './logger';
import type { RelayRouteClient } from './routes';
import { assertNoSigningMaterial, validateExpectedHash, validateSignedRawTransaction } from './transaction';

export interface CreateServerOptions {
  config: RelayConfig;
  routeClients: RelayRouteClient[];
  logger?: SafeLogger;
}

interface BroadcastRequest {
  chainId?: unknown;
  routeIds?: unknown;
  transactions?: unknown;
}

interface ValidatedBroadcastTx {
  rawTx: string;
  expectedHash: string;
  routeIds: string[];
}

interface RouteResult {
  routeId: string;
  ok: boolean;
  txHash?: string;
  error?: string;
}

interface TxResult {
  expectedHash: string;
  routeResults: RouteResult[];
}

const TOP_LEVEL_KEYS = new Set(['chainId', 'routeIds', 'transactions']);
const TX_KEYS = new Set(['rawTx', 'expectedHash', 'routeIds']);

export function createServer({ config, routeClients, logger = createSafeLogger(config.logLevel) }: CreateServerOptions): Server {
  const routeById = new Map(routeClients.map((client) => [client.id, client]));
  const acceptedHashes = new Map<string, number>();

  return createHttpServer(async (req, res) => {
    try {
      if (!applyCors(req, res, config)) return;

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && req.url === '/health') {
        json(res, 200, { ok: true, service: 'compas-fast-relay', routes: routeClients.length });
        return;
      }

      if (req.method === 'POST' && req.url === '/broadcast') {
        await handleBroadcast(req, res, config, routeById, acceptedHashes, logger);
        return;
      }

      json(res, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      logger.error('unhandled request error', error);
      json(res, 500, { ok: false, error: 'internal_error' });
    }
  });
}

async function handleBroadcast(
  req: IncomingMessage,
  res: ServerResponse,
  config: RelayConfig,
  routeById: Map<string, RelayRouteClient>,
  acceptedHashes: Map<string, number>,
  logger: SafeLogger,
): Promise<void> {
  const read = await readJsonBody(req, config.maxRawBodyBytes);
  if (!read.ok) {
    json(res, read.status, { ok: false, error: read.error });
    return;
  }

  let request: ValidatedBroadcastTx[];
  let chainId: number;
  try {
    ({ chainId, transactions: request } = validateBroadcastRequest(read.value, config, routeById, acceptedHashes));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid request';
    logger.warn('invalid broadcast request rejected', { error: message });
    json(res, 400, { ok: false, error: message });
    return;
  }

  logger.info('broadcast accepted for routing', { chainId, count: request.length, hashes: request.map((tx) => tx.expectedHash) });

  const results: TxResult[] = [];
  let hasRouteFailure = false;
  for (const tx of request) {
    const clients = tx.routeIds.map((routeId) => routeById.get(routeId)).filter((client): client is RelayRouteClient => Boolean(client));
    const routeResults = await runLimited(clients, config.concurrency, async (client) => {
      try {
        const txHash = await client.broadcast(tx.rawTx, { chainId, expectedHash: tx.expectedHash });
        return { routeId: client.id, ok: true, txHash };
      } catch (error) {
        hasRouteFailure = true;
        const message = error instanceof Error ? error.message : 'route broadcast failed';
        logger.error('route broadcast failed', { routeId: client.id, expectedHash: tx.expectedHash, error: message });
        return { routeId: client.id, ok: false, error: message };
      }
    });
    if (!hasRouteFailure) markAccepted(acceptedHashes, tx.expectedHash, config.ttlSeconds);
    results.push({ expectedHash: tx.expectedHash, routeResults });
  }

  if (hasRouteFailure) {
    json(res, 502, { ok: false, accepted: request.length, results });
    return;
  }
  json(res, 200, { ok: true, accepted: request.length, results });
}

function validateBroadcastRequest(
  value: unknown,
  config: RelayConfig,
  routeById: Map<string, RelayRouteClient>,
  acceptedHashes: Map<string, number>,
): { chainId: number; transactions: ValidatedBroadcastTx[] } {
  assertNoSigningMaterial(value);
  if (!isRecord(value)) throw new Error('request body must be a JSON object');
  rejectUnknownKeys(value, TOP_LEVEL_KEYS, '$');

  const body = value as BroadcastRequest;
  if (!Number.isInteger(body.chainId) || typeof body.chainId !== 'number') throw new Error('chainId must be an integer');
  if (!config.chainAllowlist.includes(body.chainId)) throw new Error(`chainId ${body.chainId} is not allowed`);

  const defaultRouteIds = validateRouteIds(body.routeIds, routeById, 'routeIds', routeById.size === 0);
  if (!Array.isArray(body.transactions)) throw new Error('transactions must be an array');
  if (body.transactions.length === 0) throw new Error('transactions must not be empty');
  if (body.transactions.length > config.maxTxCount) throw new Error(`transactions exceeds maxTxCount ${config.maxTxCount}`);

  pruneAccepted(acceptedHashes, config.ttlSeconds);

  return {
    chainId: body.chainId,
    transactions: body.transactions.map((item, index) => {
      if (!isRecord(item)) throw new Error(`transactions[${index}] must be an object`);
      rejectUnknownKeys(item, TX_KEYS, `transactions[${index}]`);
      const rawTx = validateSignedRawTransaction(item.rawTx);
      const expectedHash = validateExpectedHash(rawTx, item.expectedHash);
      if (acceptedHashes.has(expectedHash.toLowerCase())) {
        throw new Error(`expectedHash ${expectedHash} was already accepted within TTL`);
      }
      return {
        rawTx,
        expectedHash,
        routeIds: validateRouteIds(item.routeIds, routeById, `transactions[${index}].routeIds`, defaultRouteIds.length === 0, defaultRouteIds),
      };
    }),
  };
}

function validateRouteIds(value: unknown, routeById: Map<string, RelayRouteClient>, path: string, allowEmpty = false, fallback?: string[]): string[] {
  if (value === undefined) {
    if (fallback) return fallback;
    const all = [...routeById.keys()];
    if (all.length === 0 && !allowEmpty) throw new Error('at least one route must be configured');
    return all;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${path} must be an array of route IDs`);
  }
  const routeIds = value.map((item) => item.trim());
  if (routeIds.length === 0 && !allowEmpty) throw new Error(`${path} must not be empty`);
  const missing = routeIds.filter((routeId) => !routeById.has(routeId));
  if (missing.length > 0) throw new Error(`unknown route IDs: ${missing.join(', ')}`);
  return routeIds;
}

async function readJsonBody(req: IncomingMessage, limit: number): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    return { ok: false, status: 415, error: 'content-type must be application/json' };
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      return { ok: false, status: 413, error: 'request body too large' };
    }
    chunks.push(buffer);
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown };
  } catch {
    return { ok: false, status: 400, error: 'invalid JSON body' };
  }
}

function applyCors(req: IncomingMessage, res: ServerResponse, config: RelayConfig): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return true;
  const allowed = config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin);
  if (!allowed) {
    json(res, 403, { ok: false, error: 'origin not allowed' });
    return false;
  }
  res.setHeader('access-control-allow-origin', config.allowedOrigins.includes('*') ? '*' : origin);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  return true;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function runLimited<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker));
  return results;
}

function markAccepted(cache: Map<string, number>, expectedHash: string, ttlSeconds: number): void {
  cache.set(expectedHash.toLowerCase(), Date.now() + ttlSeconds * 1000);
}

function pruneAccepted(cache: Map<string, number>, ttlSeconds: number): void {
  const now = Date.now();
  if (ttlSeconds <= 0) {
    cache.clear();
    return;
  }
  for (const [hash, expiresAt] of cache) {
    if (expiresAt <= now) cache.delete(hash);
  }
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`unknown key ${path}.${key}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
