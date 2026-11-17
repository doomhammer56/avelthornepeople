import type { NextRequest } from "next/server";
import { staffEndpoint } from "@/server/auth/middleware";
import { StaffAuthError } from "@/server/auth/errors";
import { parseDashboardRange } from "@/server/dashboard/contract";
import { getDashboard } from "@/server/dashboard/service";
export const runtime = "nodejs";
export function GET(request: NextRequest) {
  return staffEndpoint(request, "dashboard.read", async (identity) => {
    let range;
    try {
      if (request.nextUrl.searchParams.getAll("range").length > 1)
        throw new Error();
      range = parseDashboardRange(
        request.nextUrl.searchParams.get("range") ?? undefined,
      );
    } catch {
      throw new StaffAuthError(400);
    }
    return getDashboard(identity, range);
  });
}
