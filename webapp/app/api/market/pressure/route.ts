import { NextRequest, NextResponse } from "next/server";
import { fetchLivePressure } from "@/lib/bot-pressure-live";
import { fetchOpenSeaEventsActivity } from "@/lib/opensea-events-activity";
import { assessBotPressure } from "@/lib/compas-market-fighter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug")?.trim().toLowerCase() ?? "";

  // OpenSea Events path: bot-pressure snapshot for the Market Fighter.
  if (slug) {
    const floorParam = Number(request.nextUrl.searchParams.get("floorEth"));
    const floorEth = Number.isFinite(floorParam) && floorParam > 0 ? floorParam : null;
    const activity = await fetchOpenSeaEventsActivity({ slug });
    const pressure = assessBotPressure(activity.events, floorEth);
    return NextResponse.json(
      {
        ok: activity.status === "live",
        mode: "preview-only",
        safety: { previewOnly: true, execution: "none", broadcast: false, custody: false, autoListing: false, listingSignature: false },
        source: {
          kind: activity.source,
          slug: activity.slug,
          status: activity.status,
          ...(activity.error ? { error: activity.error } : {}),
          fetchedAt: activity.fetchedAt,
          eventCount: activity.eventCount,
        },
        pressure,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // Legacy keyless Blockscout path (contract/chain) used by manual pressure inputs.
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
