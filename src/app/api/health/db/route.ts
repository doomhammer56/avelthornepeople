import { withRuntime } from "../../../../server/database/runtime.ts";

export const runtime = "nodejs";

export async function GET() {
  try {
    // Use the application's connection and role checks without reading user data.
    await withRuntime(null, async (db) => {
      await db.query("SELECT 1");
    });
    return Response.json(
      { status: "ok", database: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Connection errors can include credentials or internal hostnames.
    return Response.json(
      { status: "unavailable", database: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
