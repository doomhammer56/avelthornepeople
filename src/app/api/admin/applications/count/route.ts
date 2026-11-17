import type { NextRequest } from "next/server";
import { staffEndpoint } from "@/server/auth/middleware";
import { readNewApplicationCount } from "@/server/admin/queries";
export const runtime = "nodejs";
export function GET(request: NextRequest) {
  return staffEndpoint(request, "applications.read", async (identity) => ({
    count: await readNewApplicationCount(identity),
  }));
}
