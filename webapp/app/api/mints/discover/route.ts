import { discoverMint } from "@/lib/mint-discovery";
import type { MintDiscoveryError } from "@/lib/mint-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const chain = url.searchParams.get("chain") || "base";

  try {
    const discovery = await discoverMint(query, chain);
    return Response.json(discovery, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const body: MintDiscoveryError = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    return Response.json(body, { status: 400 });
  }
}
