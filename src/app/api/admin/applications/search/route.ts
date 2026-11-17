import type { NextRequest } from "next/server";
import {
  recruitmentErrorResponse,
  recruitmentBody,
} from "@/server/applications/http";
import { listApplications } from "@/server/applications/service";
import { staffEndpoint } from "@/server/auth/middleware";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return staffEndpoint(
    request,
    "applications.read",
    async (identity) =>
      listApplications(identity, await recruitmentBody(request)),
    { write: true, errorResponse: recruitmentErrorResponse },
  );
}
