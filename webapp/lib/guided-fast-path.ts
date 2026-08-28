import type { RelayHealthBadgeStatus } from "./low-latency-human-ux";

export type GuidedMintRoute = "fast" | "direct";

export interface GuidedFastPathTiming {
  signMs?: number;
  sendMs?: number;
  route: GuidedMintRoute;
}

export type GuidedFastPathFireOutcome =
  | "accepted"
  | "ambiguous"
  | "token-failed"
  | "network-failed"
  | "rejected";

export type GuidedFastPathAction =
  | "confirm-fast"
  | "rebroadcast-same-bytes"
  | "fallback-direct";

const ALREADY_KNOWN_PATTERN = /already known|already exists|known transaction|already in (?:the )?(?:tx ?pool|mempool)|duplicate transaction/i;
const TOKEN_FAILED_PATTERN = /failed to issue relay auth token|memory-only/i;
const RELAY_REJECTED_PATTERN = /relay rejected/i;
const LAUNCH_ID_FALLBACK = "compas-guided-mint";

/**
 * Normalize the public fast-path base URL. Returns null when the fast path is
 * unconfigured so callers fall back to the standard direct RPC broadcast.
 */
export function resolveGuidedRelayUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  return trimmed.replace(/\/+$/, "");
}

/**
 * The fast path is only attempted when it is configured and its health probe
 * answered with at least one working route. Anything else uses the standard
 * direct RPC broadcast path — the guided mint never blocks on the fast path.
 */
export function shouldUseGuidedFastPath(input: { relayUrl: string | null; health: RelayHealthBadgeStatus }): boolean {
  if (!input.relayUrl) return false;
  return input.health === "active" || input.health === "degraded";
}

/** Classify a single fast-path FIRE result into a route decision input. */
export function classifyGuidedRelayFireResult(
  result:
    | { status: "fulfilled"; value: { relayStatus: "ACCEPTED" | "AMBIGUOUS" } }
    | { status: "rejected"; reason: unknown }
    | undefined,
): GuidedFastPathFireOutcome {
  if (!result) return "network-failed";
  if (result.status === "fulfilled") {
    return result.value.relayStatus === "ACCEPTED" ? "accepted" : "ambiguous";
  }
  return classifyGuidedRelayFireError(result.reason);
}

/** Classify a thrown fast-path FIRE error (token issuance vs transport). */
export function classifyGuidedRelayFireError(error: unknown): GuidedFastPathFireOutcome {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (TOKEN_FAILED_PATTERN.test(message)) return "token-failed";
  if (RELAY_REJECTED_PATTERN.test(message)) return "rejected";
  return "network-failed";
}

/**
 * Decide what a guided mint row must do after a fast-path attempt.
 *
 * - Nothing signed yet (health/token/prepare failed): fall back to the
 *   standard direct RPC broadcast path, which signs and sends exactly once.
 * - Signed bytes exist and the fast path accepted them: the row is sent.
 * - Signed bytes exist but acceptance is not proven: rebroadcast the exact
 *   same signed bytes over direct RPC. Same bytes → same hash, so this can
 *   never double-mint and never leaves a signed row in limbo.
 */
export function decideGuidedFastPathAction(input: { outcome: GuidedFastPathFireOutcome; hasSignedBytes: boolean }): GuidedFastPathAction {
  if (!input.hasSignedBytes) return "fallback-direct";
  if (input.outcome === "accepted") return "confirm-fast";
  return "rebroadcast-same-bytes";
}

/** Same-bytes rebroadcast: "already known" style errors prove acceptance. */
export function isAlreadyKnownBroadcastError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return ALREADY_KNOWN_PATTERN.test(message);
}

/** Canonical ASCII launch slug bound into the short-lived fast-path token. */
export function guidedFastPathLaunchId(collectionAddress: string | null | undefined): string {
  const trimmed = collectionAddress?.trim().toLowerCase() ?? "";
  if (!/^0x[a-f0-9]{40}$/.test(trimmed)) return LAUNCH_ID_FALLBACK;
  return `compas-guided-${trimmed}`;
}

/** Compact secret-free receipt-row timing, e.g. "⚡ 312 ms". */
export function formatGuidedFastPathTiming(timing: GuidedFastPathTiming | null | undefined): string | null {
  if (!timing || typeof timing.sendMs !== "number" || !Number.isFinite(timing.sendMs) || timing.sendMs < 0) return null;
  return `⚡ ${Math.max(1, Math.round(timing.sendMs))} ms`;
}

/** Fuller secret-free timing line for the collapsed technical details. */
export function describeGuidedFastPathTiming(timing: GuidedFastPathTiming | null | undefined): string | null {
  if (!timing || typeof timing.sendMs !== "number" || !Number.isFinite(timing.sendMs) || timing.sendMs < 0) return null;
  const parts: string[] = [];
  if (typeof timing.signMs === "number" && Number.isFinite(timing.signMs) && timing.signMs >= 0) {
    parts.push(`Firma ${Math.max(1, Math.round(timing.signMs))} ms`);
  }
  parts.push(`Envío ${Math.max(1, Math.round(timing.sendMs))} ms`);
  parts.push(timing.route === "fast" ? "Vía rápida" : "Vía directa");
  return parts.join(" · ");
}
