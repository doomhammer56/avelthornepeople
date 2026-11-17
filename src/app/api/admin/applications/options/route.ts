import type { NextRequest } from "next/server";
import { staffEndpoint } from "@/server/auth/middleware";
import { applicationJobOptions } from "@/server/applications/service";
export const runtime = "nodejs";
export function GET(request: NextRequest) {
  return staffEndpoint(request, "applications.read", (identity) =>
    applicationJobOptions(identity, {
      q: request.nextUrl.searchParams.get("q") ?? undefined,
      page: Number(request.nextUrl.searchParams.get("page") ?? 1),
      selected: request.nextUrl.searchParams.get("selected") ?? undefined,
    }),
  );
}
