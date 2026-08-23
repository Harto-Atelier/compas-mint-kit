import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  COMPAS_AUTH_TTL_MS,
  COMPAS_GATE_NONCE_COOKIE,
  COMPAS_GATE_SESSION_COOKIE,
  encodeSessionCookie,
  issueCompasSession,
  readNonce,
} from "@/lib/compas-auth";
import { isEthAddress } from "@/lib/compas-gate";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { address?: unknown; signature?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";
  if (!isEthAddress(address) || !signature.startsWith("0x")) {
    return NextResponse.json({ error: "Invalid wallet proof" }, { status: 400 });
  }

  const jar = await cookies();
  const nonce = readNonce(jar.get(COMPAS_GATE_NONCE_COOKIE)?.value);
  if (!nonce) return NextResponse.json({ error: "Login challenge expired. Try again." }, { status: 401 });

  try {
    const session = await issueCompasSession(address, nonce.nonce, signature);
    jar.delete(COMPAS_GATE_NONCE_COOKIE);
    jar.set(COMPAS_GATE_SESSION_COOKIE, encodeSessionCookie(session), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: Math.floor(COMPAS_AUTH_TTL_MS / 1000),
    });
    return NextResponse.json({ address: session.address, compasCount: session.compasCount, verifiedAt: session.verifiedAt, expiresAt: session.expiresAt });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Wallet verification failed" }, { status: 403 });
  }
}
