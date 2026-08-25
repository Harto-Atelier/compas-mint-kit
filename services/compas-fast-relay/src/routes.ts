import type { RelayConfig, RouteConfig } from './config';

export interface BroadcastContext {
  chainId: number;
  expectedHash: string;
}

export interface RelayRouteClient {
  id: string;
  broadcast(rawTx: string, context: BroadcastContext): Promise<string>;
}

export function buildRouteClients(config: RelayConfig): RelayRouteClient[] {
  return config.routes.map((route) => createRouteClient(route, config));
}

function createRouteClient(route: RouteConfig, config: RelayConfig): RelayRouteClient {
  if (route.type !== 'json-rpc' || !route.url) {
    throw new Error(`Unsupported route ${route.id}`);
  }
  return new JsonRpcRelayRouteClient(route.id, route.url, config.ttlSeconds * 1000);
}

export class JsonRpcRelayRouteClient implements RelayRouteClient {
  constructor(public readonly id: string, private readonly url: string, private readonly timeoutMs: number) {}

  async broadcast(rawTx: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [rawTx] }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => undefined) as JsonRpcResponse | undefined;
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${this.id}`);
      }
      if (!body || typeof body !== 'object') {
        throw new Error(`Invalid JSON-RPC response from ${this.id}`);
      }
      if (body.error) {
        throw new Error(`JSON-RPC error from ${this.id}: ${body.error.message ?? 'unknown error'}`);
      }
      if (typeof body.result !== 'string') {
        throw new Error(`JSON-RPC result from ${this.id} did not include a transaction hash`);
      }
      return body.result;
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { message?: string };
}
