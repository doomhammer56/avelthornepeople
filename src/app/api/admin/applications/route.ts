import type { NextRequest } from "next/server";
import {
  recruitmentEndpoint,
  RecruitmentError,
} from "@/server/applications/http";
import { parseQuery } from "@/server/applications/contract";
import { listApplications } from "@/server/applications/service";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return recruitmentEndpoint(request, false, (identity) => {
    let query;
    try {
      query = parseQuery(request.nextUrl.searchParams);
    } catch {
      throw new RecruitmentError(400);
    }
    return listApplications(identity, query);
  });
}
