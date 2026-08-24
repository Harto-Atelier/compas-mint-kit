import { NextRequest, NextResponse } from "next/server";
import { fetchHolderPositions } from "@/lib/holder-positions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet") ?? "";
  const contract = request.nextUrl.searchParams.get("contract") ?? "";
  const chain = request.nextUrl.searchParams.get("chain") ?? "ethereum";
  const result = await fetchHolderPositions({ wallet, contract, chain });
  return NextResponse.json({
    ok: !result.error,
    mode: "preview-only",
    safety: { previewOnly: true, execution: "none", broadcast: false, custody: false },
    result,
  });
}
