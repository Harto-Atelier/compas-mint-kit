import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COMPAS_GATE_NONCE_COOKIE, createNonceToken } from "@/lib/compas-auth";

export async function POST() {
  const { token, nonce, expiresAt } = createNonceToken();
  const jar = await cookies();
  jar.set(COMPAS_GATE_NONCE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return NextResponse.json({ nonce, expiresAt });
}
