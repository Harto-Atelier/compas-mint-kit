import { runOpportunityScan } from "@/lib/opportunity-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawItems = url.searchParams.get("items") || url.searchParams.get("q") || "";
  const chain = url.searchParams.get("chain") || "base";
  const items = rawItems
    .split(/[\n,]/)
    .map((query) => ({ query: query.trim(), chain }))
    .filter((item) => item.query.length > 0);

  const result = await runOpportunityScan({ items });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
