import type { NextRequest } from "next/server";
import { jobEndpoint } from "@/server/jobs/http";
import { listAdminJobSummaries } from "@/server/jobs/management-read";
import { parseJobQuery } from "@/server/jobs/management-contract";
import { StaffAuthError } from "@/server/auth/errors";

export const runtime = "nodejs";
export function GET(request: NextRequest) {
  return jobEndpoint(request, false, (identity) => {
    let query;
    try {
      query = parseJobQuery(request.nextUrl.searchParams);
    } catch {
      throw new StaffAuthError(400);
    }
    return listAdminJobSummaries(identity, query);
  });
}
