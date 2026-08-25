export type LowLatencyNonce = number | bigint | string;

export interface LowLatencyPreparedEnvelope {
  id: string;
  from?: string;
  walletAddress?: string;
  nonce?: LowLatencyNonce;
  signedTransaction?: string;
  rawTransaction?: string;
  request?: {
    from?: string;
    nonce?: LowLatencyNonce;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface LowLatencyBroadcastContext {
  index: number;
  from: string;
  nonce?: LowLatencyNonce;
}

export interface LowLatencySchedulerOptions<T extends LowLatencyPreparedEnvelope, R> {
  concurrency: number;
  broadcast(row: T, context: LowLatencyBroadcastContext): Promise<R> | R;
  getFrom?: (row: T) => string;
  getNonce?: (row: T) => LowLatencyNonce | null | undefined;
}

export type LowLatencyBroadcastResult<T extends LowLatencyPreparedEnvelope, R> =
  | { status: "fulfilled"; index: number; row: T; value: R }
  | { status: "rejected"; index: number; row: T; reason: unknown };

interface ScheduledTask<T extends LowLatencyPreparedEnvelope> {
  row: T;
  index: number;
  from: string;
  normalizedNonce: bigint | null;
  displayNonce?: LowLatencyNonce;
}

interface AddressGroup<T extends LowLatencyPreparedEnvelope> {
  tasks: ScheduledTask<T>[];
  cursor: number;
  busy: boolean;
}

const MAX_LOW_LATENCY_ROWS = 50;

export async function scheduleLowLatencyBroadcasts<T extends LowLatencyPreparedEnvelope, R>(
  rows: readonly T[],
  options: LowLatencySchedulerOptions<T, R>,
): Promise<Array<LowLatencyBroadcastResult<T, R>>> {
  if (rows.length > MAX_LOW_LATENCY_ROWS) throw new Error(`Low-latency broadcast accepts at most 50 envelopes; received ${rows.length}.`);
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("Low-latency broadcast concurrency must be a positive integer.");
  if (rows.length === 0) return [];

  const groupsByAddress = new Map<string, AddressGroup<T>>();
  for (const [index, row] of rows.entries()) {
    const from = options.getFrom?.(row) ?? defaultFrom(row);
    const nonce = options.getNonce ? options.getNonce(row) : defaultNonce(row);
    const task: ScheduledTask<T> = {
      row,
      index,
      from,
      normalizedNonce: normalizeNonce(nonce, row.id),
      displayNonce: nonce ?? undefined,
    };
    const key = from.toLowerCase();
    const group = groupsByAddress.get(key) ?? { tasks: [], cursor: 0, busy: false };
    group.tasks.push(task);
    groupsByAddress.set(key, group);
  }

  const groups = Array.from(groupsByAddress.values());
  for (const group of groups) {
    group.tasks.sort(compareSameAddressTasks);
  }

  const concurrency = Math.min(options.concurrency, rows.length);
  const results = new Array<LowLatencyBroadcastResult<T, R>>(rows.length);
  const readyGroups = groups.filter((group) => group.tasks.length > 0);
  let active = 0;
  let finished = 0;

  return await new Promise<Array<LowLatencyBroadcastResult<T, R>>>((resolve) => {
    const pump = () => {
      if (finished === rows.length) {
        resolve(results);
        return;
      }

      readyGroups.sort((left, right) => left.tasks[left.cursor].index - right.tasks[right.cursor].index);
      while (active < concurrency && readyGroups.length > 0) {
        const group = readyGroups.shift();
        if (!group || group.busy || group.cursor >= group.tasks.length) continue;
        const task = group.tasks[group.cursor];
        group.cursor += 1;
        group.busy = true;
        active += 1;

        Promise.resolve()
          .then(() => options.broadcast(task.row, { index: task.index, from: task.from, nonce: task.displayNonce }))
          .then(
            (value) => {
              results[task.index] = { status: "fulfilled", index: task.index, row: task.row, value };
            },
            (reason) => {
              results[task.index] = { status: "rejected", index: task.index, row: task.row, reason };
            },
          )
          .finally(() => {
            active -= 1;
            finished += 1;
            group.busy = false;
            if (group.cursor < group.tasks.length) readyGroups.push(group);
            pump();
          });
      }
    };

    pump();
  });
}

function compareSameAddressTasks<T extends LowLatencyPreparedEnvelope>(left: ScheduledTask<T>, right: ScheduledTask<T>): number {
  if (left.normalizedNonce !== null && right.normalizedNonce !== null && left.normalizedNonce !== right.normalizedNonce) {
    return left.normalizedNonce < right.normalizedNonce ? -1 : 1;
  }
  return left.index - right.index;
}

function defaultFrom(row: LowLatencyPreparedEnvelope): string {
  const from = row.from ?? row.request?.from ?? row.walletAddress;
  if (!from) throw new Error(`Low-latency envelope ${row.id} is missing a from address.`);
  return from;
}

function defaultNonce(row: LowLatencyPreparedEnvelope): LowLatencyNonce | null | undefined {
  return row.nonce ?? row.request?.nonce;
}

function normalizeNonce(nonce: LowLatencyNonce | null | undefined, id: string): bigint | null {
  if (nonce === null || nonce === undefined) return null;
  if (typeof nonce === "bigint") {
    if (nonce < BigInt(0)) throw new Error(`Low-latency envelope ${id} has a negative nonce.`);
    return nonce;
  }
  if (typeof nonce === "number") {
    if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error(`Low-latency envelope ${id} has an invalid nonce.`);
    return BigInt(nonce);
  }
  const trimmed = nonce.trim();
  if (/^0x[0-9a-f]+$/i.test(trimmed)) return BigInt(trimmed);
  if (/^[0-9]+$/.test(trimmed)) return BigInt(trimmed);
  throw new Error(`Low-latency envelope ${id} has an invalid nonce.`);
}
