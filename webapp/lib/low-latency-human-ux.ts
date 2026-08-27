export type HumanMintFlowStatus = "Preparado" | "Firmado" | "Enviado" | "Confirmado" | "No completado";

export type RelayHealthBadgeStatus = "loading" | "active" | "degraded" | "unavailable";

export interface RelayHealthPayload {
  ok?: unknown;
  service?: unknown;
  routes?: unknown;
}

const PRICE_CHANGED_PATTERN = /quote|price|precio|slippage|changed|expired|stale/i;
const INSUFFICIENT_FUNDS_PATTERN = /insufficient funds|insufficient balance|fondos insuficientes|not enough funds|exceeds balance/i;
const WALLET_REJECTED_PATTERN = /user rejected|user denied|rejected by user|denied transaction|firma rechazada|rechaz/i;
const FAST_PATH_UNAVAILABLE_PATTERN = /relay|fetch failed|network|timeout|502|503|504|ECONN|unavailable|failed to issue/i;

export function humanizeMintError(error: unknown): { message: string; returnToReview: boolean } {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (WALLET_REJECTED_PATTERN.test(raw)) return { message: "Firma cancelada — revisa antes de intentar otra vez", returnToReview: true };
  if (PRICE_CHANGED_PATTERN.test(raw)) return { message: "Precio cambió — revisa de nuevo", returnToReview: true };
  if (INSUFFICIENT_FUNDS_PATTERN.test(raw)) return { message: "Sin fondos suficientes", returnToReview: true };
  if (FAST_PATH_UNAVAILABLE_PATTERN.test(raw)) return { message: "Vía rápida no disponible — puedes reintentar", returnToReview: false };
  return { message: "No completado — revisa e intenta de nuevo", returnToReview: false };
}

export function relayHealthStatusFromPayload(payload: RelayHealthPayload | null): RelayHealthBadgeStatus {
  if (!payload?.ok) return "unavailable";
  const routes = typeof payload.routes === "number" ? payload.routes : Number(payload.routes);
  if (!Number.isFinite(routes) || routes <= 0) return "unavailable";
  if (routes === 3) return "active";
  if (routes >= 1 && routes <= 2) return "degraded";
  return "degraded";
}

export function relayHealthLabel(status: RelayHealthBadgeStatus): string {
  if (status === "loading") return "Comprobando vía rápida";
  if (status === "active") return "Vía rápida activa";
  if (status === "degraded") return "Vía rápida degradada";
  return "No disponible";
}

export function blockscoutTxUrl(hash: string): string {
  return `https://robinhoodchain.blockscout.com/tx/${hash}`;
}
