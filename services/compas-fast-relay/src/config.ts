export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface RouteConfig {
  id: string;
  type: 'json-rpc' | 'injected';
  url?: string;
}

export interface RelayConfig {
  port: number;
  authSecret?: string;
  allowedOrigins: string[];
  chainAllowlist: number[];
  maxRawBodyBytes: number;
  maxTxCount: number;
  concurrency: number;
  ttlSeconds: number;
  logLevel: LogLevel;
  routes: RouteConfig[];
}

type Env = Record<string, string | undefined>;

const DEFAULT_PORT = 8787;
const DEFAULT_BODY_LIMIT = 64 * 1024;
const DEFAULT_MAX_TX_COUNT = 10;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TTL_SECONDS = 30;

export function loadConfig(env: Env = process.env): RelayConfig {
  const routes: RouteConfig[] = [];
  addJsonRpcRoute(routes, 'robinhood-sequencer', env.ROBINHOOD_SEQUENCER_URL);
  addJsonRpcRoute(routes, 'alchemy', env.ALCHEMY_RPC_URL);
  addJsonRpcRoute(routes, 'quicknode', env.QUICKNODE_RPC_URL);

  const extraRoutes = parseRouteJson(env.RELAY_ROUTES_JSON);
  routes.push(...extraRoutes);

  return {
    port: integer(env.RELAY_PORT, DEFAULT_PORT, 'RELAY_PORT'),
    authSecret: optionalSecret(env.RELAY_AUTH_SECRET ?? env.COMPAS_RELAY_AUTH_SECRET),
    allowedOrigins: list(env.RELAY_ALLOWED_ORIGINS),
    chainAllowlist: numberList(env.RELAY_CHAIN_ALLOWLIST, [1, 8453], 'RELAY_CHAIN_ALLOWLIST'),
    maxRawBodyBytes: integer(env.RELAY_MAX_RAW_BODY_BYTES, DEFAULT_BODY_LIMIT, 'RELAY_MAX_RAW_BODY_BYTES'),
    maxTxCount: integer(env.RELAY_MAX_TX_COUNT, DEFAULT_MAX_TX_COUNT, 'RELAY_MAX_TX_COUNT'),
    concurrency: integer(env.RELAY_CONCURRENCY, DEFAULT_CONCURRENCY, 'RELAY_CONCURRENCY'),
    ttlSeconds: integer(env.RELAY_TTL_SECONDS, DEFAULT_TTL_SECONDS, 'RELAY_TTL_SECONDS'),
    logLevel: logLevel(env.RELAY_LOG_LEVEL),
    routes,
  };
}

function addJsonRpcRoute(routes: RouteConfig[], id: string, url: string | undefined): void {
  if (!url || !url.trim()) return;
  routes.push({ id, type: 'json-rpc', url: url.trim() });
}

function optionalSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function integer(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function list(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function numberList(value: string | undefined, fallback: number[], name: string): number[] {
  if (!value || value.trim() === '') return fallback;
  const numbers = list(value).map((item) => Number(item));
  if (numbers.length === 0 || numbers.some((item) => !Number.isInteger(item) || item <= 0)) {
    throw new Error(`${name} must be a comma-separated list of positive integer chain IDs`);
  }
  return numbers;
}

function logLevel(value: string | undefined): LogLevel {
  const parsed = (value ?? 'info').trim().toLowerCase();
  if (parsed === 'debug' || parsed === 'info' || parsed === 'warn' || parsed === 'error' || parsed === 'silent') {
    return parsed;
  }
  throw new Error('RELAY_LOG_LEVEL must be debug, info, warn, error, or silent');
}

function parseRouteJson(value: string | undefined): RouteConfig[] {
  if (!value || !value.trim()) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('RELAY_ROUTES_JSON must be an array');
  return parsed.map((item, index) => {
    if (!isRecord(item)) throw new Error(`RELAY_ROUTES_JSON[${index}] must be an object`);
    const id = item.id;
    const type = item.type;
    const url = item.url;
    if (typeof id !== 'string' || !id.trim()) throw new Error(`RELAY_ROUTES_JSON[${index}].id is required`);
    if (type !== 'json-rpc') throw new Error(`RELAY_ROUTES_JSON[${index}].type must be json-rpc`);
    if (typeof url !== 'string' || !url.trim()) throw new Error(`RELAY_ROUTES_JSON[${index}].url is required`);
    return { id: id.trim(), type, url: url.trim() };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
