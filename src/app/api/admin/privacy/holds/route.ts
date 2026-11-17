import type { NextRequest } from "next/server";
import { privacyEndpoint } from "@/server/privacy/http";
import { readLegalHolds } from "@/server/privacy/service";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return privacyEndpoint(request, false, (identity) =>
    readLegalHolds(identity, Object.fromEntries(request.nextUrl.searchParams)),
  );
}
