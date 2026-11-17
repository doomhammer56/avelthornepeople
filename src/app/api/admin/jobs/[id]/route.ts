import { NextRequest } from "next/server";
import { z } from "zod";
import { jobEndpoint, jobBody, JobNotFound } from "@/server/jobs/http";
import { manageJob } from "@/server/jobs/management";
import { readAdminJobs } from "@/server/admin/queries";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  return jobEndpoint(request, false, async (identity) => {
    const id = z.uuid().parse((await context.params).id);
    const job = (await readAdminJobs(identity, id))[0];
    if (!job) throw new JobNotFound();
    return { job };
  });
}
export async function PATCH(request: NextRequest, context: Context) {
  return jobEndpoint(request, true, async (identity) =>
    manageJob(
      identity,
      "save",
      (await context.params).id,
      await jobBody(request),
    ),
  );
}
