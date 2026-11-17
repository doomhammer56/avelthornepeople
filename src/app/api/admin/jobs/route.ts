import { NextRequest } from "next/server";
import { jobEndpoint, jobBody } from "@/server/jobs/http";
import { manageJob } from "@/server/jobs/management";
import { listAdminJobs } from "@/server/jobs/management-read";
import { parseJobQuery } from "@/server/jobs/management-contract";
import { StaffAuthError } from "@/server/auth/errors";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return jobEndpoint(request, false, (identity) => {
    let query;
    try {
      query = parseJobQuery(request.nextUrl.searchParams);
    } catch {
      throw new StaffAuthError(400);
    }
    return listAdminJobs(identity, query);
  });
}
export async function POST(request: NextRequest) {
  return jobEndpoint(
    request,
    true,
    async (identity) =>
      manageJob(identity, "create", undefined, await jobBody(request)),
    201,
  );
}
