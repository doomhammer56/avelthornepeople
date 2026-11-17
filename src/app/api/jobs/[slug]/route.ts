import { findPublishedJob } from "@/server/jobs/public";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const job = await findPublishedJob(slug);
    return Response.json(job ? { job } : { error: "Job not found" }, {
      status: job ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Job temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
