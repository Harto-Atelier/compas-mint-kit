export const COMPAS_CONTRACT = "0xED346CEF754407662144336Fd2835d3600168d1f";
export const COMPAS_GATE_STORAGE_KEY = "compas.walletGate.v1";
export const COMPAS_ETH_RPC_URL = "https://ethereum.publicnode.com";

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const BALANCE_OF_SELECTOR = "0x70a08231";
const GATE_TTL_MS = 24 * 60 * 60 * 1000;

export type CompasGateSession = {
  address: string;
  compasCount: number;
  verifiedAt: number;
};

export function isEthAddress(value: string): boolean {
  return ETH_ADDRESS_RE.test(value);
}

export function balanceOfCalldata(address: string): string {
  if (!isEthAddress(address)) throw new Error("Invalid Ethereum address");
  return `${BALANCE_OF_SELECTOR}${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

export function parseBalanceResult(result: unknown): number {
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)) return 0;
  const value = Number.parseInt(result, 16);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export async function fetchCompasBalance(address: string, rpcUrl: string = COMPAS_ETH_RPC_URL): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "compas-gate-balance",
      method: "eth_call",
      params: [{ to: COMPAS_CONTRACT, data: balanceOfCalldata(address) }, "latest"],
    }),
  });
  if (!response.ok) throw new Error(`RPC returned ${response.status}`);
  const json = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return parseBalanceResult(json.result);
}

export function serializeGateSession(session: CompasGateSession): string {
  return JSON.stringify(session);
}

export function parseGateSession(raw: string | null): CompasGateSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CompasGateSession>;
    if (
      typeof parsed.address !== "string" ||
      !isEthAddress(parsed.address) ||
      typeof parsed.compasCount !== "number" ||
      parsed.compasCount < 1 ||
      typeof parsed.verifiedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.verifiedAt > GATE_TTL_MS) return null;
    return { address: parsed.address, compasCount: parsed.compasCount, verifiedAt: parsed.verifiedAt };
  } catch {
    return null;
  }
}

export function readGateSession(): CompasGateSession | null {
  if (typeof window === "undefined") return null;
  return parseGateSession(window.sessionStorage.getItem(COMPAS_GATE_STORAGE_KEY));
}

export function writeGateSession(session: CompasGateSession): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(COMPAS_GATE_STORAGE_KEY, serializeGateSession(session));
  window.dispatchEvent(new Event("compas-gate-session"));
}

export function clearGateSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(COMPAS_GATE_STORAGE_KEY);
  window.dispatchEvent(new Event("compas-gate-session"));
}

export async function fetchSignedGateSession(): Promise<CompasGateSession | null> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin" });
  if (!response.ok) return null;
  const json = (await response.json()) as { address?: unknown; compasCount?: unknown; verifiedAt?: unknown };
  if (typeof json.address !== "string" || !isEthAddress(json.address) || typeof json.compasCount !== "number" || typeof json.verifiedAt !== "number") return null;
  return { address: json.address, compasCount: json.compasCount, verifiedAt: json.verifiedAt };
}

export async function clearSignedGateSession(): Promise<void> {
  await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin" }).catch(() => null);
  clearGateSession();
}
