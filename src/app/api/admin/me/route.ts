import type { NextRequest } from "next/server";
import { staffEndpoint } from "@/server/auth/middleware";
export const runtime = "nodejs";
export function GET(request: NextRequest) {
  return staffEndpoint(
    request,
    "console.read",
    async (_identity, staff) => staff,
  );
}
