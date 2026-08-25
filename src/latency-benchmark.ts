import fs from "fs";
import http from "http";
import https from "https";
import { performance } from "perf_hooks";

import { resolveChain } from "./chains";
import { parseRpcEndpoints } from "./rpc-blast";

export interface BenchmarkMeasurement {
  totalMs?: number;
  dnsMs?: number;
  tcpMs?: number;
  tlsMs?: number;
  requestMs?: number;
  responseMs?: number;
  statusCode?: number;
  error?: string;
}

export interface LatencyStats {
  samples: number;
  successes: number;
  errors: number;
  rateLimited: number;
  errorPct: number;
  rateLimitedPct: number;
  minMs: number | null;
  maxMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  jitterMs: number | null;
}

export interface BenchmarkProvider {
  label: string;
  provider: string;
  region: string;
  url: string;
  displayUrl: string;
  method: string;
  path?: string;
}

export interface BenchmarkWebSocketFeed {
  label: string;
  provider: string;
  region: string;
  url: string;
  displayUrl: string;
  status: "placeholder";
  health: "not-measured";
  note: string;
}

export interface BenchmarkConfig {
  sampleCount: number;
  warmupCount: number;
  timeoutMs: number;
  method: string;
  providers: BenchmarkProvider[];
  websocketFeeds: BenchmarkWebSocketFeed[];
}

export interface EndpointSummary {
  label: string;
  provider?: string;
  region?: string;
  displayUrl?: string;
  method?: string;
  total: LatencyStats;
  phases: {
    dns: LatencyStats;
    tcp: LatencyStats;
    tls: LatencyStats;
    request: LatencyStats;
    response: LatencyStats;
  };
  lastError?: string;
  measurements?: BenchmarkMeasurement[];
}

export interface BenchmarkReport {
  generatedAt: string;
  config: {
    sampleCount: number;
    warmupCount: number;
    timeoutMs: number;
    method: string;
  };
  endpoints: EndpointSummary[];
  websocketFeeds: BenchmarkWebSocketFeed[];
}

interface RawProviderConfig {
  label?: unknown;
  provider?: unknown;
  region?: unknown;
  url?: unknown;
  method?: unknown;
  path?: unknown;
}

interface RawWebSocketConfig {
  label?: unknown;
  provider?: unknown;
  region?: unknown;
  url?: unknown;
}

const DEFAULT_SAMPLE_COUNT = 25;
const DEFAULT_WARMUP_COUNT = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_METHOD = "eth_chainId";
const DEFAULT_REGION = "public";
const RAW_TRANSACTION_LIKE_RE = /0x[0-9a-fA-F]{130,}/g;
const PRIVATE_KEY_LIKE_RE = /(?:^|[^0-9a-fA-F])((?:0x)?[0-9a-fA-F]{64})(?=$|[^0-9a-fA-F])/g;
const JWT_LIKE_RE = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SECRET_QUERY_KEYS = new Set([
  "apikey",
  "api_key",
  "key",
  "token",
  "access_token",
  "auth",
  "authorization",
  "secret",
  "password",
  "pass",
]);

export function calculateLatencyStats(measurements: BenchmarkMeasurement[]): LatencyStats {
  const samples = measurements.length;
  const successes = measurements.filter((m) => !m.error && isFiniteNumber(m.totalMs)).length;
  const errors = measurements.filter((m) => Boolean(m.error)).length;
  const rateLimited = measurements.filter((m) => m.statusCode === 429).length;
  const values = measurements
    .filter((m) => !m.error && isFiniteNumber(m.totalMs))
    .map((m) => Number(m.totalMs))
    .sort((a, b) => a - b);

  return {
    samples,
    successes,
    errors,
    rateLimited,
    errorPct: round2(percent(errors, samples)),
    rateLimitedPct: round2(percent(rateLimited, samples)),
    minMs: values.length ? round2(values[0]) : null,
    maxMs: values.length ? round2(values[values.length - 1]) : null,
    p50Ms: percentile(values, 50),
    p90Ms: percentile(values, 90),
    p95Ms: percentile(values, 95),
    p99Ms: percentile(values, 99),
    jitterMs: values.length ? round2(stddev(values)) : null,
  };
}

export function summarizeEndpointMeasurements(
  label: string,
  measurements: BenchmarkMeasurement[],
  metadata: Partial<Pick<EndpointSummary, "provider" | "region" | "displayUrl" | "method">> = {},
): EndpointSummary {
  return {
    label,
    ...metadata,
    total: calculateLatencyStats(measurements),
    phases: {
      dns: calculatePhaseStats(measurements, "dnsMs"),
      tcp: calculatePhaseStats(measurements, "tcpMs"),
      tls: calculatePhaseStats(measurements, "tlsMs"),
      request: calculatePhaseStats(measurements, "requestMs"),
      response: calculatePhaseStats(measurements, "responseMs"),
    },
    lastError: [...measurements].reverse().find((m) => m.error)?.error,
    measurements,
  };
}

export function calculatePhaseStats(
  measurements: BenchmarkMeasurement[],
  field: keyof Pick<BenchmarkMeasurement, "dnsMs" | "tcpMs" | "tlsMs" | "requestMs" | "responseMs">,
): LatencyStats {
  const phaseMeasurements = measurements
    .filter((m) => !m.error && isFiniteNumber(m[field]))
    .map((m) => ({ totalMs: Number(m[field]), statusCode: m.statusCode }));
  return calculateLatencyStats(phaseMeasurements);
}

export function parseBenchmarkConfig(raw: unknown, env: Record<string, string | undefined> = process.env): BenchmarkConfig {
  const obj = isRecord(raw) ? raw : {};
  const method = stringValue(obj.method) || stringValue(obj.rpcMethod) || env.BENCHMARK_RPC_METHOD || DEFAULT_METHOD;
  const sampleCount = positiveInteger(obj.sampleCount ?? obj.samples ?? env.BENCHMARK_SAMPLES, DEFAULT_SAMPLE_COUNT);
  const warmupCount = nonNegativeInteger(obj.warmupCount ?? obj.warmups ?? env.BENCHMARK_WARMUPS, DEFAULT_WARMUP_COUNT);
  const timeoutMs = positiveInteger(obj.timeoutMs ?? env.BENCHMARK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const providers = parseProviders(obj, method, env);
  const websocketFeeds = parseWebSocketFeeds(obj);

  if (providers.length === 0) {
    throw new Error("Benchmark config must include at least one HTTP RPC provider endpoint");
  }

  return {
    sampleCount,
    warmupCount,
    timeoutMs,
    method,
    providers,
    websocketFeeds,
  };
}

export async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkReport> {
  const endpointSummaries: EndpointSummary[] = [];

  for (const provider of config.providers) {
    const measurements = await measureProvider(provider, config);
    endpointSummaries.push(summarizeEndpointMeasurements(provider.label, measurements, {
      provider: provider.provider,
      region: provider.region,
      displayUrl: provider.displayUrl,
      method: provider.method,
    }));
  }

  return {
    generatedAt: new Date().toISOString(),
    config: {
      sampleCount: config.sampleCount,
      warmupCount: config.warmupCount,
      timeoutMs: config.timeoutMs,
      method: config.method,
    },
    endpoints: endpointSummaries,
    websocketFeeds: config.websocketFeeds,
  };
}

export function formatBenchmarkTable(report: BenchmarkReport): string {
  const headers = [
    "label",
    "provider",
    "region",
    "n",
    "err%",
    "429%",
    "p50",
    "p90",
    "p95",
    "p99",
    "min",
    "max",
    "jitter",
    "dns",
    "tcp",
    "tls",
    "req",
    "resp",
  ];
  const rows = report.endpoints.map((endpoint) => [
    endpoint.label,
    endpoint.provider || "-",
    endpoint.region || "-",
    String(endpoint.total.samples),
    fmtNum(endpoint.total.errorPct),
    fmtNum(endpoint.total.rateLimitedPct),
    fmtMs(endpoint.total.p50Ms),
    fmtMs(endpoint.total.p90Ms),
    fmtMs(endpoint.total.p95Ms),
    fmtMs(endpoint.total.p99Ms),
    fmtMs(endpoint.total.minMs),
    fmtMs(endpoint.total.maxMs),
    fmtMs(endpoint.total.jitterMs),
    fmtMs(endpoint.phases.dns.p50Ms),
    fmtMs(endpoint.phases.tcp.p50Ms),
    fmtMs(endpoint.phases.tls.p50Ms),
    fmtMs(endpoint.phases.request.p50Ms),
    fmtMs(endpoint.phases.response.p50Ms),
  ]);

  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  const output = [
    `Robinhood route latency benchmark (${report.generatedAt})`,
    `samples=${report.config.sampleCount} warmups=${report.config.warmupCount} timeoutMs=${report.config.timeoutMs} method=${report.config.method}`,
    "",
    line(headers),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map(line),
  ];

  if (report.websocketFeeds.length > 0) {
    output.push("", "WebSocket / Sequencer feed placeholders:");
    for (const feed of report.websocketFeeds) {
      output.push(`  ${feed.label} [${feed.provider}/${feed.region}] ${feed.status}; health=${feed.health}; ${feed.note}`);
    }
  }

  return output.join("\n");
}

export function redactBenchmarkValue(value: unknown): string {
  let text = String(value ?? "")
    .replace(RAW_TRANSACTION_LIKE_RE, "[redacted-raw-transaction]")
    .replace(PRIVATE_KEY_LIKE_RE, (match, key: string) => match.replace(key, "[redacted-64-hex]"))
    .replace(JWT_LIKE_RE, "[redacted-jwt]");

  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => redactUrl(match));
  text = text.replace(/wss?:\/\/[^\s"'<>]+/gi, (match) => redactUrl(match));
  return text;
}

export async function runBenchmarkCli(rawArgs: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseBenchmarkArgs(rawArgs);
  if (args.help) {
    console.log(BENCHMARK_HELP);
    return;
  }

  const config = parseBenchmarkConfig(loadConfigPayload(args), process.env);
  applyArgOverrides(config, args);
  const report = await runBenchmark(config);
  const json = JSON.stringify(report, null, 2);

  if (args.outputPath) {
    fs.writeFileSync(args.outputPath, `${json}\n`);
  }

  if (args.format === "json") {
    console.log(json);
  } else if (args.format === "table") {
    console.log(formatBenchmarkTable(report));
  } else {
    console.log(formatBenchmarkTable(report));
    console.log("\nJSON:");
    console.log(json);
  }
}

async function measureProvider(provider: BenchmarkProvider, config: BenchmarkConfig): Promise<BenchmarkMeasurement[]> {
  const url = new URL(provider.url);
  const isHttps = url.protocol === "https:";
  const agent = isHttps
    ? new https.Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 })
    : new http.Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });

  try {
    for (let i = 0; i < config.warmupCount; i++) {
      await measureHttp(provider, config.timeoutMs, agent).catch(() => undefined);
    }

    const measurements: BenchmarkMeasurement[] = [];
    for (let i = 0; i < config.sampleCount; i++) {
      measurements.push(await measureHttp(provider, config.timeoutMs, agent));
    }
    return measurements;
  } finally {
    agent.destroy();
  }
}

function measureHttp(
  provider: BenchmarkProvider,
  timeoutMs: number,
  agent: http.Agent | https.Agent,
): Promise<BenchmarkMeasurement> {
  const url = new URL(provider.url);
  const isHttps = url.protocol === "https:";
  if (!isHttps && url.protocol !== "http:") {
    return Promise.resolve({ error: `Unsupported protocol ${url.protocol}`, totalMs: 0 });
  }

  const transport = isHttps ? https : http;
  const body = JSON.stringify({ jsonrpc: "2.0", method: provider.method, params: [], id: 1 });
  const start = performance.now();
  let lookupAt: number | undefined;
  let connectAt: number | undefined;
  let secureAt: number | undefined;
  let finishAt: number | undefined;
  let responseAt: number | undefined;
  let settled = false;

  return new Promise((resolve) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        agent,
        timeout: timeoutMs,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "compas-robinhood-latency-benchmark/1.0",
        },
      },
      (res) => {
        responseAt = performance.now();
        res.on("end", () => {
          if (settled) return;
          settled = true;
          resolve(buildMeasurement(start, performance.now(), {
            lookupAt,
            connectAt,
            secureAt,
            finishAt,
            responseAt,
            statusCode: res.statusCode,
          }));
        });
        res.on("error", (err) => {
          if (settled) return;
          settled = true;
          resolve(buildMeasurement(start, performance.now(), {
            lookupAt,
            connectAt,
            secureAt,
            finishAt,
            responseAt,
            error: redactBenchmarkValue(err.message),
            statusCode: res.statusCode,
          }));
        });
        res.resume();
      },
    );

    req.on("socket", (socket) => {
      socket.once("lookup", () => {
        lookupAt = performance.now();
      });
      socket.once("connect", () => {
        connectAt = performance.now();
      });
      socket.once("secureConnect", () => {
        secureAt = performance.now();
      });
    });

    req.on("finish", () => {
      finishAt = performance.now();
    });

    req.on("timeout", () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });

    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      resolve(buildMeasurement(start, performance.now(), {
        lookupAt,
        connectAt,
        secureAt,
        finishAt,
        error: redactBenchmarkValue(err.message),
      }));
    });

    req.end(body);
  });
}

function buildMeasurement(
  start: number,
  end: number,
  timings: {
    lookupAt?: number;
    connectAt?: number;
    secureAt?: number;
    finishAt?: number;
    responseAt?: number;
    statusCode?: number;
    error?: string;
  },
): BenchmarkMeasurement {
  const connectedAt = timings.secureAt ?? timings.connectAt;
  const measurement: BenchmarkMeasurement = {
    totalMs: round2(end - start),
    statusCode: timings.statusCode,
    error: timings.error,
  };

  if (timings.lookupAt) measurement.dnsMs = round2(timings.lookupAt - start);
  if (timings.connectAt) measurement.tcpMs = round2(timings.connectAt - (timings.lookupAt ?? start));
  if (timings.secureAt && timings.connectAt) measurement.tlsMs = round2(timings.secureAt - timings.connectAt);
  if (timings.finishAt) measurement.requestMs = round2(timings.finishAt - (connectedAt ?? start));
  if (timings.responseAt) measurement.responseMs = round2(end - timings.responseAt);
  return measurement;
}

function parseProviders(obj: Record<string, unknown>, method: string, env: Record<string, string | undefined>): BenchmarkProvider[] {
  const rawProviders = Array.isArray(obj.providers)
    ? obj.providers
    : Array.isArray(obj.endpoints)
      ? obj.endpoints
      : [];
  const parsed = rawProviders
    .map((entry, i) => parseProvider(entry as RawProviderConfig, i, method))
    .filter((provider): provider is BenchmarkProvider => Boolean(provider));

  if (parsed.length > 0) return parsed;

  const cliUrls = splitList(env.BENCHMARK_RPC_URLS || env.RPC_URL_ROBINHOOD || env.RPC_URL);
  if (cliUrls.length > 0) {
    return parseRpcEndpoints(cliUrls).map((endpoint) => ({
      label: endpoint.label,
      provider: providerNameFromLabel(endpoint.label),
      region: env.BENCHMARK_REGION || DEFAULT_REGION,
      url: endpoint.url,
      displayUrl: redactBenchmarkValue(endpoint.url),
      method,
    }));
  }

  const robinhood = resolveChain("robinhood", env);
  return (robinhood?.rpc.public ?? ["https://rpc.mainnet.chain.robinhood.com/"]).map((url, i) => ({
    label: i === 0 ? "robinhood-public" : `robinhood-public-${i + 1}`,
    provider: "Robinhood",
    region: DEFAULT_REGION,
    url,
    displayUrl: redactBenchmarkValue(url),
    method,
  }));
}

function parseProvider(raw: RawProviderConfig, index: number, defaultMethod: string): BenchmarkProvider | null {
  if (!isRecord(raw)) return null;
  const url = stringValue(raw.url);
  if (!url) return null;
  const label = stringValue(raw.label) || safeHostLabel(url, index);
  return {
    label,
    provider: stringValue(raw.provider) || providerNameFromLabel(label),
    region: stringValue(raw.region) || DEFAULT_REGION,
    url,
    displayUrl: redactBenchmarkValue(url),
    method: stringValue(raw.method) || defaultMethod,
    path: stringValue(raw.path),
  };
}

function parseWebSocketFeeds(obj: Record<string, unknown>): BenchmarkWebSocketFeed[] {
  const rawFeeds = Array.isArray(obj.websocketFeeds)
    ? obj.websocketFeeds
    : Array.isArray(obj.websockets)
      ? obj.websockets
      : [];
  return rawFeeds
    .map((entry, i) => parseWebSocketFeed(entry as RawWebSocketConfig, i))
    .filter((feed): feed is BenchmarkWebSocketFeed => Boolean(feed));
}

function parseWebSocketFeed(raw: RawWebSocketConfig, index: number): BenchmarkWebSocketFeed | null {
  if (!isRecord(raw)) return null;
  const url = stringValue(raw.url);
  if (!url) return null;
  const label = stringValue(raw.label) || safeHostLabel(url, index);
  return {
    label,
    provider: stringValue(raw.provider) || providerNameFromLabel(label),
    region: stringValue(raw.region) || DEFAULT_REGION,
    url,
    displayUrl: redactBenchmarkValue(url),
    status: "placeholder",
    health: "not-measured",
    note: "Sequencer WebSocket feed handshake/health is intentionally stubbed; configure endpoint now, wire protocol-specific health later.",
  };
}

interface ParsedBenchmarkArgs {
  help: boolean;
  configPath?: string;
  outputPath?: string;
  format: "json" | "table" | "both";
  sampleCount?: number;
  warmupCount?: number;
  timeoutMs?: number;
  method?: string;
  url?: string;
  label?: string;
  provider?: string;
  region?: string;
}

const BENCHMARK_HELP = `
Robinhood route latency benchmark

Usage
  npm run dev -- benchmark [options]
  node dist/index.js benchmark [options]

Options
  --config <file>        JSON config with providers[] and optional websocketFeeds[]
  --url <url>            Add/override a single HTTP RPC URL
  --label <label>        Label for --url (default: hostname)
  --provider <name>      Provider label for --url/table (default: inferred)
  --region <region>      Region label for --url/table (default: public)
  --samples <n>          Warmed sample count per provider (default: ${DEFAULT_SAMPLE_COUNT})
  --warmup <n>           Warmup requests before samples (default: ${DEFAULT_WARMUP_COUNT})
  --timeout-ms <n>       Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --method <rpc>         JSON-RPC method (default: ${DEFAULT_METHOD})
  --format <mode>        table, json, or both (default: table)
  --output <file>        Also write sanitized JSON report to a file

Environment fallback
  BENCHMARK_RPC_URLS     Comma-separated HTTP RPC URLs
  BENCHMARK_SAMPLES      Sample count
  BENCHMARK_WARMUPS      Warmup count
  BENCHMARK_TIMEOUT_MS   Request timeout
  BENCHMARK_RPC_METHOD   JSON-RPC method
`;

function parseBenchmarkArgs(args: string[]): ParsedBenchmarkArgs {
  const parsed: ParsedBenchmarkArgs = { help: false, format: "table" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => args[++i];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--config" || arg === "-c") parsed.configPath = next();
    else if (arg === "--output" || arg === "-o") parsed.outputPath = next();
    else if (arg === "--format") parsed.format = parseFormat(next());
    else if (arg === "--json") parsed.format = "json";
    else if (arg === "--table") parsed.format = "table";
    else if (arg === "--both") parsed.format = "both";
    else if (arg === "--samples" || arg === "--sample-count") parsed.sampleCount = positiveInteger(next(), DEFAULT_SAMPLE_COUNT);
    else if (arg === "--warmup" || arg === "--warmups" || arg === "--warmup-count") parsed.warmupCount = nonNegativeInteger(next(), DEFAULT_WARMUP_COUNT);
    else if (arg === "--timeout-ms") parsed.timeoutMs = positiveInteger(next(), DEFAULT_TIMEOUT_MS);
    else if (arg === "--method") parsed.method = next();
    else if (arg === "--url") parsed.url = next();
    else if (arg === "--label") parsed.label = next();
    else if (arg === "--provider") parsed.provider = next();
    else if (arg === "--region") parsed.region = next();
    else throw new Error(`Unknown benchmark option: ${arg}`);
  }
  return parsed;
}

function loadConfigPayload(args: ParsedBenchmarkArgs): unknown {
  if (!args.configPath) return {};
  try {
    return JSON.parse(fs.readFileSync(args.configPath, "utf8"));
  } catch (err: any) {
    throw new Error(`Failed to read benchmark config ${args.configPath}: ${redactBenchmarkValue(err.message)}`);
  }
}

function applyArgOverrides(config: BenchmarkConfig, args: ParsedBenchmarkArgs): void {
  if (args.sampleCount !== undefined) config.sampleCount = args.sampleCount;
  if (args.warmupCount !== undefined) config.warmupCount = args.warmupCount;
  if (args.timeoutMs !== undefined) config.timeoutMs = args.timeoutMs;
  if (args.method) {
    config.method = args.method;
    config.providers = config.providers.map((provider) => ({ ...provider, method: args.method || provider.method }));
  }
  if (args.url) {
    const label = args.label || safeHostLabel(args.url, 0);
    config.providers = [{
      label,
      provider: args.provider || providerNameFromLabel(label),
      region: args.region || DEFAULT_REGION,
      url: args.url,
      displayUrl: redactBenchmarkValue(args.url),
      method: config.method,
    }];
  }
}

function parseFormat(value: string | undefined): "json" | "table" | "both" {
  if (value === "json" || value === "table" || value === "both") return value;
  throw new Error("--format must be table, json, or both");
}

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const auth = url.username || url.password ? "[redacted-url-secret]@" : "";
    const pathParts = url.pathname.split("/").map((part) => isSecretPathPart(part) ? "[redacted-url-secret]" : part);
    const searchParams = new URLSearchParams(url.search);
    for (const key of [...searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) {
        searchParams.set(key, "[redacted]");
      }
    }
    const query = searchParams.toString()
      .replace(/%5Bredacted%5D/gi, "[redacted]");
    return `${url.protocol}//${auth}${url.host}${pathParts.join("/")}${query ? `?${query}` : ""}${url.hash}`;
  } catch {
    return "[redacted-url]";
  }
}

function isSecretPathPart(part: string): boolean {
  if (!part) return false;
  if (/(secret|token|apikey|api_key|key|password|auth)/i.test(part)) return true;
  if (/^[A-Za-z0-9_-]{16,}$/.test(part)) return true;
  if (/^[0-9a-fA-F]{32,}$/.test(part)) return true;
  return false;
}

function safeHostLabel(rawUrl: string, index: number): string {
  try {
    return new URL(rawUrl).hostname || `endpoint-${index + 1}`;
  } catch {
    return `endpoint-${index + 1}`;
  }
}

function providerNameFromLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("robinhood")) return "Robinhood";
  if (lower.includes("alchemy")) return "Alchemy";
  if (lower.includes("quicknode")) return "QuickNode";
  if (lower.includes("infura")) return "Infura";
  if (lower.includes("ankr")) return "Ankr";
  if (lower.includes("publicnode")) return "PublicNode";
  return "custom";
}

function percentile(sortedValues: number[], percentileValue: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sortedValues.length) - 1));
  return round2(sortedValues[index]);
}

function stddev(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percent(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function fmtMs(value: number | null): string {
  return value === null ? "-" : fmtNum(value);
}

function fmtNum(value: number | null): string {
  return value === null ? "-" : value.toFixed(value % 1 === 0 ? 0 : 2);
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
