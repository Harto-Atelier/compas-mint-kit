import type { LogLevel } from './config';

export interface SafeLogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

type Sink = (line: string) => void;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export function createSafeLogger(level: LogLevel = 'info', sink: Sink = (line) => console.error(line)): SafeLogger {
  const threshold = LEVEL_WEIGHT[level];
  const write = (entryLevel: Exclude<LogLevel, 'silent'>, message: string, meta?: unknown) => {
    if (LEVEL_WEIGHT[entryLevel] < threshold) return;
    const payload = {
      ts: new Date().toISOString(),
      level: entryLevel,
      message: redact(message),
      ...(meta === undefined ? {} : { meta: sanitize(meta) }),
    };
    sink(JSON.stringify(payload));
  };
  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}

export function sanitize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message) };
  }
  if (typeof value === 'string') return redact(value);
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = sanitize(nested);
    }
  }
  return out;
}

export function redact(text: string): string {
  return text.replace(/0x[a-fA-F0-9]{64,}/g, '[redacted-raw-tx]');
}

function isSensitiveKey(key: string): boolean {
  return /rawtx|rawtransaction|privatekey|secretkey|seedphrase|mnemonic|signingkey/i.test(key);
}
