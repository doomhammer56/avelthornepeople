import type { NextRequest } from "next/server";
import { z } from "zod";
import { staffEndpoint } from "@/server/auth/middleware";
import { readAuthBody } from "@/server/auth/http";
import { manageStaff } from "@/server/auth/lifecycle";
import { authErrorResponse, StaffAuthError } from "@/server/auth/errors";
import { readStaffAccounts } from "@/server/team/service";
const pageQuery = z
  .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
  .strict();
export const runtime = "nodejs";
function teamErrorResponse(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "P0002")
    return Response.json(
      { error: "Staff member unavailable" },
      { status: 404 },
    );
  return authErrorResponse(
    error instanceof z.ZodError || ["22023", "22P02"].includes(code)
      ? new StaffAuthError(400)
      : // Audit history, jobs or content still point at this member.
        code === "23503"
        ? new StaffAuthError(409, "has_records")
        : code === "42501"
          ? new StaffAuthError(403)
          : ["40001", "55000", "23505"].includes(code)
            ? new StaffAuthError(409)
            : error,
  );
}
export function GET(request: NextRequest) {
  return staffEndpoint(
    request,
    "team.read",
    async (identity) => {
      const params = request.nextUrl.searchParams;
      if (new Set(params.keys()).size !== [...params.keys()].length)
        throw new StaffAuthError(400);
      return readStaffAccounts(
        identity,
        pageQuery.parse(Object.fromEntries(params)).page,
      );
    },
    { errorResponse: teamErrorResponse },
  );
}
export function POST(request: NextRequest) {
  return staffEndpoint(
    request,
    "team.manage",
    async (identity) => {
      const result = await manageStaff(identity, await readAuthBody(request));
      return Response.json(result, {
        status:
          "providerSync" in result && result.providerSync === "pending"
            ? 202
            : 200,
      });
    },
    { write: true, errorResponse: teamErrorResponse },
  );
}
