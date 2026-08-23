import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COMPAS_GATE_SESSION_COOKIE, readSessionCookie } from "@/lib/compas-auth";

export async function GET() {
  const jar = await cookies();
  const session = readSessionCookie(jar.get(COMPAS_GATE_SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, address: session.address, compasCount: session.compasCount, verifiedAt: session.verifiedAt, expiresAt: session.expiresAt });
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(COMPAS_GATE_SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
