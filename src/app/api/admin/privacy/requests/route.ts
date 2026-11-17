import type { NextRequest } from "next/server";
import { privacyEndpoint, privacyBody } from "@/server/privacy/http";
import {
  readDeletionRequests,
  registerDeletionRequest,
} from "@/server/privacy/service";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return privacyEndpoint(request, false, (identity) =>
    readDeletionRequests(
      identity,
      Object.fromEntries(request.nextUrl.searchParams),
    ),
  );
}
export async function POST(request: NextRequest) {
  return privacyEndpoint(request, true, async (identity) =>
    registerDeletionRequest(identity, await privacyBody(request)),
  );
}
