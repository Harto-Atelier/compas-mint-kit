import { RUN_CONFIG_JSON_SCHEMA, buildRunConfigExport, type RunConfigExportError } from "@/lib/run-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 64_000;

export async function GET() {
  return Response.json(RUN_CONFIG_JSON_SCHEMA, {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) throw new Error("RunConfig export request is too large.");
    const body = await request.json();
    const exportBody = buildRunConfigExport(body);
    return Response.json(exportBody, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const body: RunConfigExportError = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    return Response.json(body, { status: 400 });
  }
}
