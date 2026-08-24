import { NextRequest, NextResponse } from "next/server";
import { fetchLivePressure } from "@/lib/bot-pressure-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const contract = request.nextUrl.searchParams.get("contract") ?? "";
  const chain = request.nextUrl.searchParams.get("chain") ?? "ethereum";
  const metrics = await fetchLivePressure({ contract, chain });
  return NextResponse.json({
    ok: !metrics.error,
    mode: "preview-only",
    safety: { previewOnly: true, execution: "none", broadcast: false, custody: false },
    metrics,
  });
}
