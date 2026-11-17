import { NextRequest } from "next/server";
import { jobEndpoint, jobBody } from "@/server/jobs/http";
import { manageJob } from "@/server/jobs/management";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return jobEndpoint(request, true, async (identity) =>
    manageJob(identity, "action", (await params).id, await jobBody(request)),
  );
}
