import { fetchOpenSeaDropsFeed } from "@/lib/opensea-drops-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "live";
  const limit = Number(url.searchParams.get("limit") || 30);
  const result = await fetchOpenSeaDropsFeed({ mode, limit });
  return Response.json(result, {
    status: result.ok ? 200 : 502,
    headers: { "cache-control": "no-store" },
  });
}
