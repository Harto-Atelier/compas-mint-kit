import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COMPAS_GATE_SESSION_COOKIE, readSessionCookie } from "@/lib/compas-auth";
import { issueRelayAuthToken, parseRelayAuthRequest, RELAY_AUTH_ENV_KEY } from "@/lib/relay-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const jar = await cookies();
  const session = readSessionCookie(jar.get(COMPAS_GATE_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ ok: false, error: "Compas holder session required." }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const body = (await request.json().catch(() => null)) as unknown;
  try {
    const relayRequest = parseRelayAuthRequest(body);
    const issued = issueRelayAuthToken({ holderAddress: session.address, ...relayRequest });
    return NextResponse.json(
      {
        ok: true,
        token: issued.token,
        tokenType: issued.tokenType,
        holderAddress: issued.holderAddress,
        launchId: issued.launchId,
        chainId: issued.chainId,
        purpose: issued.purpose,
        maxTransactionCount: issued.maxTransactionCount,
        issuedAt: issued.issuedAt,
        expiresAt: issued.expiresAt,
        storage: "memory-only; do not persist in browser storage",
      },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Relay token request failed.";
    const missingSecret = message.includes(RELAY_AUTH_ENV_KEY);
    return NextResponse.json(
      { ok: false, error: missingSecret ? "Relay token issuer is not configured." : message },
      { status: missingSecret ? 503 : 400, headers: NO_STORE_HEADERS },
    );
  }
}

export function GET() {
  return NextResponse.json(
    { ok: false, error: "POST with a Compas holder session is required to issue a short-lived relay token." },
    { status: 405, headers: { ...NO_STORE_HEADERS, allow: "POST" } },
  );
}
