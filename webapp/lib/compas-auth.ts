import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { verifyMessage } from "ethers";

import { fetchCompasBalance, isEthAddress, type CompasGateSession } from "@/lib/compas-gate";

export const COMPAS_GATE_NONCE_COOKIE = "compas_gate_nonce";
export const COMPAS_GATE_SESSION_COOKIE = "compas_gate_session";
export const COMPAS_AUTH_TTL_MS = 24 * 60 * 60 * 1000;
export const COMPAS_NONCE_TTL_MS = 10 * 60 * 1000;

const DEFAULT_SECRET = "compas-mint-kit-preview-gate-secret-v1";

export type SignedGateSession = CompasGateSession & {
  expiresAt: number;
};

export type NoncePayload = {
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

function secret(): string {
  return process.env.COMPAS_GATE_SECRET || process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || DEFAULT_SECRET;
}

export function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function encodeSignedPayload(payload: object): string {
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function decodeSignedPayload<T>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  if (!safeEqual(sign(body), signature)) return null;
  try {
    return JSON.parse(base64UrlDecode(body)) as T;
  } catch {
    return null;
  }
}

export function createNonceToken(now = Date.now()): { token: string; nonce: string; expiresAt: number } {
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = now + COMPAS_NONCE_TTL_MS;
  return {
    nonce,
    expiresAt,
    token: encodeSignedPayload({ nonce, issuedAt: now, expiresAt } satisfies NoncePayload),
  };
}

export function readNonce(token: string | undefined | null, now = Date.now()): NoncePayload | null {
  const payload = decodeSignedPayload<NoncePayload>(token);
  if (!payload || typeof payload.nonce !== "string" || typeof payload.expiresAt !== "number") return null;
  if (payload.expiresAt < now) return null;
  return payload;
}

export function buildCompasChallenge(address: string, nonce: string): string {
  return [
    "Compas Mint Kit holder login",
    "",
    "Sign this message to prove wallet ownership. No transaction will be sent.",
    `Address: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

export function verifyCompasSignature(address: string, nonce: string, signature: string): boolean {
  if (!isEthAddress(address) || typeof signature !== "string" || !signature.startsWith("0x")) return false;
  try {
    const recovered = verifyMessage(buildCompasChallenge(address, nonce), signature);
    return recovered.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

export async function issueCompasSession(address: string, nonce: string, signature: string, now = Date.now()): Promise<SignedGateSession> {
  if (!verifyCompasSignature(address, nonce, signature)) throw new Error("Invalid wallet signature");
  const compasCount = await fetchCompasBalance(address);
  if (compasCount < 1) throw new Error("This wallet holds no Compas");
  return { address, compasCount, verifiedAt: now, expiresAt: now + COMPAS_AUTH_TTL_MS };
}

export function encodeSessionCookie(session: SignedGateSession): string {
  return encodeSignedPayload(session);
}

export function readSessionCookie(token: string | undefined | null, now = Date.now()): SignedGateSession | null {
  const session = decodeSignedPayload<SignedGateSession>(token);
  if (!session || !isEthAddress(session.address) || typeof session.compasCount !== "number" || session.compasCount < 1 || typeof session.expiresAt !== "number") return null;
  if (session.expiresAt < now) return null;
  return session;
}
