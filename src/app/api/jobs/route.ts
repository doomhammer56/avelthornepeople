import { publishedJobPage } from "@/server/jobs/public";
import { publicJobQuery } from "@/lib/publicJobQuery";

export async function GET(request: Request) {
  try {
    return Response.json(
      await publishedJobPage(publicJobQuery(new URL(request.url).searchParams)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Jobs temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
