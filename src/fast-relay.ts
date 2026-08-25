import { prepareBlast, redactSensitive, type PreparedBlast } from "./rpc-blast";

export type FastRelayAggregateState = "ACCEPTED" | "AMBIGUOUS" | "REJECTED";
export type FastRelayRouteOutcome =
  | "ACCEPTED"
  | "ALREADY_KNOWN"
  | "REJECTED"
  | "TIMEOUT"
  | "CONNECTION_ERROR"
  | "RATE_LIMITED"
  | "MALFORMED"
  | "HASH_MISMATCH"
  | "HTTP_ERROR";

export interface FastRelayRpcEndpoint {
  url: string;
  label: string;
}

export type FastRelayFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface FastRelayRouteResult {
  label: string;
  url: string;
  outcome: FastRelayRouteOutcome;
  txHash: string | null;
  error: string | null;
  httpStatus?: number;
  definiteAcceptance: boolean;
  definitiveRejection: boolean;
  ambiguous: boolean;
}

export interface FastRelayRaceResult {
  state: FastRelayAggregateState;
  expectedTxHash: string;
  routes: FastRelayRouteResult[];
  acceptedBy: FastRelayRouteResult[];
  rejectedBy: FastRelayRouteResult[];
  ambiguousRoutes: FastRelayRouteResult[];
}

export interface FastRelayOptions {
  fetch?: FastRelayFetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const ALREADY_KNOWN_RE = /already\s+(?:known|exists|imported|seen)|known transaction|already in (?:the )?mempool|transaction already in(?: the)? pool/i;
const RATE_LIMIT_RE = /rate.?limit|too many requests|429/i;
const TIMEOUT_RE = /timeout|timed out|aborted|abort/i;
const CONNECTION_AMBIGUITY_RE = /network|connection|connreset|econnreset|enotfound|econnrefused|socket|fetch failed|gateway|temporarily unavailable|service unavailable|internal server error|bad gateway/i;

export async function relaySameHashToRpcs(
  rawTxOrPrepared: string | PreparedBlast,
  endpoints: FastRelayRpcEndpoint[],
  options: FastRelayOptions = {}
): Promise<FastRelayRaceResult> {
  if (endpoints.length === 0) throw new Error("Fast relay requires at least one RPC endpoint.");

  const prepared = typeof rawTxOrPrepared === "string" ? prepareBlast(rawTxOrPrepared) : rawTxOrPrepared;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("Fast relay requires a fetch implementation.");

  const routes = await Promise.all(
    endpoints.map((endpoint) => submitPreparedSameHash(prepared, endpoint, fetchImpl, options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
  );

  return aggregateFastRelayRoutes(prepared.txHash, routes);
}

export function aggregateFastRelayRoutes(expectedTxHash: string, routes: FastRelayRouteResult[]): FastRelayRaceResult {
  const acceptedBy = routes.filter((route) => route.definiteAcceptance);
  const rejectedBy = routes.filter((route) => route.definitiveRejection);
  const ambiguousRoutes = routes.filter((route) => route.ambiguous);
  const state: FastRelayAggregateState = acceptedBy.length > 0 ? "ACCEPTED" : ambiguousRoutes.length > 0 ? "AMBIGUOUS" : "REJECTED";

  return {
    state,
    expectedTxHash,
    routes,
    acceptedBy,
    rejectedBy,
    ambiguousRoutes,
  };
}

async function submitPreparedSameHash(
  prepared: PreparedBlast,
  endpoint: FastRelayRpcEndpoint,
  fetchImpl: FastRelayFetch,
  timeoutMs: number
): Promise<FastRelayRouteResult> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: prepared.body,
      signal: controller?.signal,
    });

    return await classifyFastRelayResponse(endpoint, response, prepared.txHash);
  } catch (error) {
    return classifyFastRelayError(endpoint, error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function classifyFastRelayResponse(
  endpoint: FastRelayRpcEndpoint,
  response: Response,
  expectedTxHash: string
): Promise<FastRelayRouteResult> {
  if (response.status === 429) {
    return route(endpoint, "RATE_LIMITED", {
      error: await responseMessage(response, "HTTP 429 Too Many Requests"),
      httpStatus: response.status,
      ambiguous: true,
    });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    return route(endpoint, "MALFORMED", {
      error: redactSensitive(errorMessage(error, "Malformed RPC JSON response")),
      httpStatus: response.status,
      ambiguous: true,
    });
  }

  if (!isJsonObject(json)) {
    return route(endpoint, "MALFORMED", {
      error: "Malformed RPC response: expected object",
      httpStatus: response.status,
      ambiguous: true,
    });
  }

  const result = json.result;
  if (typeof result === "string" && result.length > 0) {
    if (normalizeHash(result) === normalizeHash(expectedTxHash)) {
      return route(endpoint, "ACCEPTED", {
        txHash: result,
        httpStatus: response.status,
        definiteAcceptance: true,
      });
    }

    return route(endpoint, "HASH_MISMATCH", {
      txHash: result,
      error: `RPC returned unexpected transaction hash ${redactSensitive(result)}; expected ${expectedTxHash}`,
      httpStatus: response.status,
      ambiguous: true,
    });
  }

  if (isJsonObject(json.error)) {
    return classifyRpcError(endpoint, json.error, response.status);
  }

  if (!response.ok) {
    return route(endpoint, "HTTP_ERROR", {
      error: `HTTP ${response.status} ${response.statusText}`.trim(),
      httpStatus: response.status,
      ambiguous: true,
    });
  }

  return route(endpoint, "MALFORMED", {
    error: "Malformed RPC response: missing result and error",
    httpStatus: response.status,
    ambiguous: true,
  });
}

function classifyRpcError(endpoint: FastRelayRpcEndpoint, rpcError: Record<string, unknown>, httpStatus?: number): FastRelayRouteResult {
  const message = redactSensitive(
    typeof rpcError.message === "string" ? rpcError.message : JSON.stringify(rpcError)
  );

  if (ALREADY_KNOWN_RE.test(message)) {
    return route(endpoint, "ALREADY_KNOWN", {
      error: message,
      httpStatus,
      definiteAcceptance: true,
    });
  }

  if (httpStatus === 429 || RATE_LIMIT_RE.test(message)) {
    return route(endpoint, "RATE_LIMITED", {
      error: message,
      httpStatus,
      ambiguous: true,
    });
  }

  if (TIMEOUT_RE.test(message)) {
    return route(endpoint, "TIMEOUT", {
      error: message,
      httpStatus,
      ambiguous: true,
    });
  }

  if (CONNECTION_AMBIGUITY_RE.test(message) || (httpStatus !== undefined && httpStatus >= 500)) {
    return route(endpoint, httpStatus !== undefined && httpStatus >= 500 ? "HTTP_ERROR" : "CONNECTION_ERROR", {
      error: message,
      httpStatus,
      ambiguous: true,
    });
  }

  return route(endpoint, "REJECTED", {
    error: message,
    httpStatus,
    definitiveRejection: true,
  });
}

function classifyFastRelayError(endpoint: FastRelayRpcEndpoint, error: unknown): FastRelayRouteResult {
  const name = typeof error === "object" && error && "name" in error ? String((error as { name?: unknown }).name) : "";
  const message = redactSensitive(errorMessage(error, "RPC request failed"));
  const combined = `${name} ${message}`;
  const outcome: FastRelayRouteOutcome = TIMEOUT_RE.test(combined) ? "TIMEOUT" : "CONNECTION_ERROR";

  return route(endpoint, outcome, {
    error: message,
    ambiguous: true,
  });
}

function route(
  endpoint: FastRelayRpcEndpoint,
  outcome: FastRelayRouteOutcome,
  fields: Partial<Omit<FastRelayRouteResult, "label" | "url" | "outcome">> = {}
): FastRelayRouteResult {
  const definiteAcceptance = fields.definiteAcceptance === true;
  const definitiveRejection = fields.definitiveRejection === true;
  const ambiguous = fields.ambiguous === true;
  return {
    label: endpoint.label,
    url: endpoint.url,
    outcome,
    txHash: fields.txHash ?? null,
    error: fields.error ?? null,
    httpStatus: fields.httpStatus,
    definiteAcceptance,
    definitiveRejection,
    ambiguous,
  };
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const json = await response.json();
    if (isJsonObject(json) && isJsonObject(json.error)) {
      const message = json.error.message;
      if (typeof message === "string" && message.length > 0) return redactSensitive(message);
    }
    return redactSensitive(JSON.stringify(json));
  } catch {
    try {
      const text = await response.text();
      return redactSensitive(text || fallback);
    } catch {
      return fallback;
    }
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHash(value: string): string {
  return value.toLowerCase();
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return fallback;
}
