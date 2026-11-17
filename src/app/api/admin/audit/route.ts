import type { NextRequest } from "next/server";
import { z } from "zod";
import { staffEndpoint } from "@/server/auth/middleware";
import { authErrorResponse, StaffAuthError } from "@/server/auth/errors";
import { readAudit } from "@/server/audit/service";
export const runtime = "nodejs";
export function GET(request: NextRequest) {
  return staffEndpoint(
    request,
    "audit.read",
    async (identity) => {
      const params = request.nextUrl.searchParams;
      if (new Set(params.keys()).size !== [...params.keys()].length)
        throw new StaffAuthError(400);
      return readAudit(identity, Object.fromEntries(params));
    },
    {
      errorResponse: (error) =>
        authErrorResponse(
          error instanceof z.ZodError ? new StaffAuthError(400) : error,
        ),
    },
  );
}
