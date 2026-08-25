import type { BrowserSignedMint } from "./browser-broadcast";
import { scheduleLowLatencyBroadcasts } from "./low-latency-scheduler";

export interface LowLatencyRelayTokenResponse {
  ok: true;
  token: string;
  expiresAt: number;
  storage: string;
}

export interface LowLatencyRelayBroadcastAccepted {
  ok: true;
  expectedHash: string;
  relayStatus: "ACCEPTED" | "AMBIGUOUS";
  responseStatus: number;
  responseBody: unknown;
}

export interface LowLatencyRelayFireInput {
  relayUrl: string;
  launchId: string;
  chainId: number;
  planBinding: string;
  signedMints: BrowserSignedMint[];
  routeIds?: string[];
  concurrency?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export type LowLatencyRelayFireResult =
  | { status: "fulfilled"; index: number; envelopeId: string; expectedHash: string; value: LowLatencyRelayBroadcastAccepted }
  | { status: "rejected"; index: number; envelopeId: string; expectedHash: string; reason: unknown };

export interface LowLatencyRelayEnvelope {
  id: string;
  walletAddress: string;
  request: { nonce?: number; from?: string };
  expectedHash: string;
  signedMint: BrowserSignedMint;
  [key: string]: unknown;
}

const MAX_LOW_LATENCY_FIRE_COUNT = 50;

export async function fireSignedMintsViaRelay(input: LowLatencyRelayFireInput): Promise<LowLatencyRelayFireResult[]> {
  const fetcher = input.fetchImpl ?? fetch;
  const relayUrl = normalizeRelayUrl(input.relayUrl);
  const signedMints = [...input.signedMints];
  if (signedMints.length === 0) throw new Error("At least one signed transaction is required before FIRE.");
  if (signedMints.length > MAX_LOW_LATENCY_FIRE_COUNT) throw new Error("Low-latency FIRE accepts at most 50 signed transactions.");
  if (!input.planBinding || signedMints.some((mint) => mint.binding !== input.planBinding)) throw new Error("Every signed transaction must match the same plan binding.");
  if (signedMints.some((mint) => mint.transaction.chain.chainId !== input.chainId)) throw new Error("Every signed transaction must match the relay chain id.");

  const expectedHashes = signedMints.map((mint) => normalizeHash(mint.expectedHash, "expectedHash"));
  if (new Set(expectedHashes).size !== expectedHashes.length) throw new Error("Signed transactions must have unique expected hashes.");

  const token = await issueRelayToken(fetcher, {
    launchId: input.launchId,
    chainId: input.chainId,
    purpose: "broadcast",
    maxTransactionCount: signedMints.length,
    expectedHashes,
    planBinding: input.planBinding,
  });

  const envelopes = signedMints.map((signedMint): LowLatencyRelayEnvelope => ({
    id: signedMint.transaction.id,
    walletAddress: signedMint.transaction.walletAddress,
    request: { nonce: signedMint.transaction.request.nonce, from: signedMint.transaction.walletAddress },
    expectedHash: signedMint.expectedHash,
    signedMint,
  }));

  const scheduled = await scheduleLowLatencyBroadcasts(envelopes, {
    concurrency: input.concurrency ?? Math.min(8, envelopes.length),
    broadcast: async (envelope): Promise<LowLatencyRelayBroadcastAccepted> => {
      const rawTx = envelope.signedMint.rawSignedTransaction.revealForBroadcast({
        explicitConsent: true,
        lowLatencyBinding: envelope.signedMint.lowLatencyBinding,
      });
      const response = await fetcher(`${relayUrl}/broadcast`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token.token}`,
        },
        body: JSON.stringify({
          chainId: input.chainId,
          routeIds: input.routeIds,
          transactions: [{ rawTx, expectedHash: envelope.expectedHash, routeIds: input.routeIds }],
        }),
      });
      const responseBody = await response.json().catch(() => null) as unknown;
      if (response.status === 200) {
        return { ok: true, expectedHash: envelope.expectedHash, relayStatus: "ACCEPTED", responseStatus: response.status, responseBody };
      }
      if (response.status === 202 || response.status === 502 || response.status === 504 || response.status === 429) {
        return { ok: true, expectedHash: envelope.expectedHash, relayStatus: "AMBIGUOUS", responseStatus: response.status, responseBody };
      }
      throw new Error(`Relay rejected ${envelope.expectedHash}: HTTP ${response.status}`);
    },
  });

  return scheduled.map((result): LowLatencyRelayFireResult => {
    if (result.status === "fulfilled") {
      return { status: "fulfilled", index: result.index, envelopeId: result.row.id, expectedHash: result.row.expectedHash, value: result.value };
    }
    return { status: "rejected", index: result.index, envelopeId: result.row.id, expectedHash: result.row.expectedHash, reason: result.reason };
  });
}

async function issueRelayToken(fetcher: typeof fetch, body: Record<string, unknown>): Promise<LowLatencyRelayTokenResponse> {
  const response = await fetcher("/api/relay/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null) as unknown;
  if (!response.ok || !isRelayTokenResponse(json)) throw new Error("Failed to issue relay auth token.");
  if (!/memory-only/i.test(json.storage)) throw new Error("Relay token response must declare memory-only storage.");
  return json;
}

function isRelayTokenResponse(value: unknown): value is LowLatencyRelayTokenResponse {
  return typeof value === "object" && value !== null
    && (value as { ok?: unknown }).ok === true
    && typeof (value as { token?: unknown }).token === "string"
    && typeof (value as { expiresAt?: unknown }).expiresAt === "number"
    && typeof (value as { storage?: unknown }).storage === "string";
}

function normalizeRelayUrl(value: string): string {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) throw new Error("Relay URL must be an absolute HTTP(S) URL.");
  return trimmed.replace(/\/+$/, "");
}

function normalizeHash(value: string, label: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte hex hash.`);
  return value.toLowerCase();
}
