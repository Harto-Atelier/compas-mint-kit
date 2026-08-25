export const ROBINHOOD_CHAIN_ID = 4663;

type EnvLike = Record<string, string | undefined>;

export type RobinhoodLowLatencyRouteKind = "sequencer" | "alchemy" | "quicknode" | "custom";
export type RobinhoodLowLatencyRouteId = "robinhood-sequencer" | "robinhood-alchemy" | "robinhood-quicknode" | string;
export type EndpointHealthStatus = "healthy" | "degraded" | "down" | "unsampled";
export type RobinhoodRouteConfigStatus = "disabled" | "ready" | "blocked";

export interface LowLatencyFeatureFlags {
  LOW_LATENCY_BROADCAST: boolean;
  MULTI_RPC: boolean;
  ROBINHOOD_SEQUENCER: boolean;
}

export interface RobinhoodLowLatencyRoute {
  id: RobinhoodLowLatencyRouteId;
  label: string;
  kind: RobinhoodLowLatencyRouteKind;
  chainId: typeof ROBINHOOD_CHAIN_ID;
  url: string;
  source: "env" | "config";
  featureFlag?: keyof LowLatencyFeatureFlags;
}

export interface RobinhoodRouteResolution {
  chainId: typeof ROBINHOOD_CHAIN_ID;
  status: RobinhoodRouteConfigStatus;
  flags: LowLatencyFeatureFlags;
  routes: RobinhoodLowLatencyRoute[];
  blockers: string[];
  warnings: string[];
}

export interface RobinhoodRouteLatencySample {
  routeId: RobinhoodLowLatencyRouteId;
  ok: boolean;
  latencyMs: number;
  sampledAt?: string;
  error?: string;
}

export interface RobinhoodEndpointHealth {
  id: RobinhoodLowLatencyRouteId;
  label: string;
  kind: RobinhoodLowLatencyRouteKind;
  chainId: typeof ROBINHOOD_CHAIN_ID;
  url: string;
  status: EndpointHealthStatus;
  sampleCount: number;
  successCount: number;
  failureCount: number;
  latencyMs: {
    p50: number | null;
    p95: number | null;
  };
  lastSampledAt: string | null;
  lastError: string | null;
}

export interface RobinhoodRouteHealthReport {
  chainId: typeof ROBINHOOD_CHAIN_ID;
  generatedAt: string;
  endpoints: RobinhoodEndpointHealth[];
  aggregate: {
    configuredCount: number;
    healthyCount: number;
    degradedCount: number;
    downCount: number;
    unsampledCount: number;
    ready: boolean;
  };
}

const TRUTHY = new Set(["1", "true", "yes", "on", "enabled"]);
const ROUTE_URL_ENV: Record<"sequencer" | "alchemy" | "quicknode", string[]> = {
  sequencer: ["ROBINHOOD_SEQUENCER_RPC_URL", "RPC_URL_ROBINHOOD_SEQUENCER"],
  alchemy: ["ROBINHOOD_ALCHEMY_RPC_URL", "ALCHEMY_ROBINHOOD_RPC_URL", "RPC_URL_ROBINHOOD_ALCHEMY"],
  quicknode: ["ROBINHOOD_QUICKNODE_RPC_URL", "QUICKNODE_ROBINHOOD_RPC_URL", "RPC_URL_ROBINHOOD_QUICKNODE"],
};

export function parseLowLatencyFeatureFlags(env: EnvLike = process.env): LowLatencyFeatureFlags {
  return {
    LOW_LATENCY_BROADCAST: flagEnabled(env.LOW_LATENCY_BROADCAST),
    MULTI_RPC: flagEnabled(env.MULTI_RPC),
    ROBINHOOD_SEQUENCER: flagEnabled(env.ROBINHOOD_SEQUENCER),
  };
}

export function resolveRobinhoodLowLatencyRoutes(env: EnvLike = process.env): RobinhoodRouteResolution {
  const flags = parseLowLatencyFeatureFlags(env);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!flags.LOW_LATENCY_BROADCAST) {
    return {
      chainId: ROBINHOOD_CHAIN_ID,
      status: "disabled",
      flags,
      routes: [],
      blockers: ["LOW_LATENCY_BROADCAST is disabled; Robinhood low-latency routes are not active."],
      warnings,
    };
  }

  if (!flags.MULTI_RPC) {
    blockers.push("MULTI_RPC must be enabled before Robinhood low-latency route racing is active.");
  }

  const routes: RobinhoodLowLatencyRoute[] = [];
  const sequencerUrl = firstConfiguredUrl(env, ROUTE_URL_ENV.sequencer);
  if (flags.ROBINHOOD_SEQUENCER) {
    if (sequencerUrl) {
      routes.push(route("robinhood-sequencer", "Robinhood Sequencer direct", "sequencer", sequencerUrl, "env", "ROBINHOOD_SEQUENCER"));
    } else {
      blockers.push("ROBINHOOD_SEQUENCER is enabled but ROBINHOOD_SEQUENCER_RPC_URL is not configured.");
    }
  } else if (sequencerUrl) {
    warnings.push("ROBINHOOD_SEQUENCER is disabled; configured sequencer URL was ignored.");
  }

  const alchemyUrl = firstConfiguredUrl(env, ROUTE_URL_ENV.alchemy);
  if (alchemyUrl) {
    routes.push(route("robinhood-alchemy", "Alchemy Robinhood RPC", "alchemy", alchemyUrl, "env"));
  } else {
    blockers.push("Missing Alchemy Robinhood RPC endpoint (set ROBINHOOD_ALCHEMY_RPC_URL or ALCHEMY_ROBINHOOD_RPC_URL).");
  }

  const quicknodeUrl = firstConfiguredUrl(env, ROUTE_URL_ENV.quicknode);
  if (quicknodeUrl) {
    routes.push(route("robinhood-quicknode", "QuickNode Robinhood RPC", "quicknode", quicknodeUrl, "env"));
  } else {
    blockers.push("Missing QuickNode Robinhood RPC endpoint (set ROBINHOOD_QUICKNODE_RPC_URL or QUICKNODE_ROBINHOOD_RPC_URL).");
  }

  routes.push(...routesFromJsonConfig(env, warnings));
  const deduped = dedupeRoutes(routes);

  if (flags.MULTI_RPC && deduped.length < 2) {
    blockers.push("At least two Robinhood low-latency endpoints are required when MULTI_RPC is enabled.");
  }

  return {
    chainId: ROBINHOOD_CHAIN_ID,
    status: blockers.length === 0 ? "ready" : "blocked",
    flags,
    routes: blockers.length === 0 ? deduped : [],
    blockers,
    warnings,
  };
}

export function buildRobinhoodRouteHealthReport(
  routes: readonly RobinhoodLowLatencyRoute[],
  samples: readonly RobinhoodRouteLatencySample[],
  nowIso = new Date().toISOString(),
): RobinhoodRouteHealthReport {
  const endpoints = routes.map((endpoint) => endpointHealth(endpoint, samples));
  const count = (status: EndpointHealthStatus) => endpoints.filter((endpoint) => endpoint.status === status).length;

  return {
    chainId: ROBINHOOD_CHAIN_ID,
    generatedAt: nowIso,
    endpoints,
    aggregate: {
      configuredCount: routes.length,
      healthyCount: count("healthy"),
      degradedCount: count("degraded"),
      downCount: count("down"),
      unsampledCount: count("unsampled"),
      ready: endpoints.length > 0 && endpoints.every((endpoint) => endpoint.status === "healthy" || endpoint.status === "degraded"),
    },
  };
}

export function maskEndpointUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) {
      url.username = url.username ? "…" : "";
      url.password = url.password ? "…" : "";
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      if (looksSensitivePathSegment(last)) {
        segments[segments.length - 1] = `${last.slice(0, 4)}…${last.slice(-4)}`;
      }
      url.pathname = `/${segments.join("/")}`;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

function endpointHealth(endpoint: RobinhoodLowLatencyRoute, samples: readonly RobinhoodRouteLatencySample[]): RobinhoodEndpointHealth {
  const endpointSamples = samples.filter((sample) => sample.routeId === endpoint.id);
  const successes = endpointSamples.filter((sample) => sample.ok && Number.isFinite(sample.latencyMs) && sample.latencyMs >= 0);
  const failures = endpointSamples.filter((sample) => !sample.ok);
  const latencies = successes.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const sortedSamples = endpointSamples.slice().sort((a, b) => String(a.sampledAt ?? "").localeCompare(String(b.sampledAt ?? "")));
  const lastSample = sortedSamples.length > 0 ? sortedSamples[sortedSamples.length - 1] : undefined;
  const status: EndpointHealthStatus = endpointSamples.length === 0
    ? "unsampled"
    : successes.length === 0
      ? "down"
      : failures.length > 0
        ? "degraded"
        : "healthy";

  return {
    id: endpoint.id,
    label: endpoint.label,
    kind: endpoint.kind,
    chainId: ROBINHOOD_CHAIN_ID,
    url: maskEndpointUrl(endpoint.url),
    status,
    sampleCount: endpointSamples.length,
    successCount: successes.length,
    failureCount: failures.length,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
    },
    lastSampledAt: lastSample?.sampledAt ?? null,
    lastError: [...endpointSamples].reverse().find((sample) => !sample.ok && sample.error)?.error ?? null,
  };
}

function route(
  id: RobinhoodLowLatencyRouteId,
  label: string,
  kind: RobinhoodLowLatencyRouteKind,
  url: string,
  source: "env" | "config",
  featureFlag?: keyof LowLatencyFeatureFlags,
): RobinhoodLowLatencyRoute {
  return { id, label, kind, chainId: ROBINHOOD_CHAIN_ID, url, source, featureFlag };
}

function routesFromJsonConfig(env: EnvLike, warnings: string[]): RobinhoodLowLatencyRoute[] {
  const raw = env.ROBINHOOD_LOW_LATENCY_ROUTES_JSON || env.LOW_LATENCY_ROUTES_JSON;
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.routes)
        ? parsed.routes
        : isRecord(parsed) && isRecord(parsed.robinhood) && Array.isArray(parsed.robinhood.routes)
          ? parsed.robinhood.routes
          : [];
    return entries.map(parseConfigRoute).filter((value): value is RobinhoodLowLatencyRoute => Boolean(value));
  } catch {
    warnings.push("ROBINHOOD_LOW_LATENCY_ROUTES_JSON could not be parsed and was ignored.");
    return [];
  }
}

function parseConfigRoute(value: unknown): RobinhoodLowLatencyRoute | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "robinhood-custom";
  const label = typeof value.label === "string" && value.label.trim() ? value.label.trim() : id;
  const kind = typeof value.kind === "string" && ["sequencer", "alchemy", "quicknode", "custom"].includes(value.kind)
    ? value.kind as RobinhoodLowLatencyRouteKind
    : "custom";
  const chainId = Number(value.chainId ?? ROBINHOOD_CHAIN_ID);
  const url = typeof value.url === "string" ? cleanUrl(value.url) : null;
  if (chainId !== ROBINHOOD_CHAIN_ID || !url) return null;
  return route(id, label, kind, url, "config");
}

function firstConfiguredUrl(env: EnvLike, names: readonly string[]): string | null {
  for (const name of names) {
    const url = cleanUrl(env[name]);
    if (url) return url;
  }
  return null;
}

function cleanUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

function dedupeRoutes(routes: RobinhoodLowLatencyRoute[]): RobinhoodLowLatencyRoute[] {
  const seen = new Set<string>();
  const deduped: RobinhoodLowLatencyRoute[] = [];
  for (const candidate of routes) {
    const key = candidate.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function percentile(sortedValues: readonly number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[index];
}

function flagEnabled(value: string | undefined): boolean {
  return TRUTHY.has((value || "").trim().toLowerCase());
}

function looksSensitivePathSegment(value: string): boolean {
  return value.length >= 8 && /^[A-Za-z0-9_-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
