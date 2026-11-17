import type { NextRequest } from "next/server";
import { privacyEndpoint } from "@/server/privacy/http";
import { readDeletionRequests } from "@/server/privacy/service";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return privacyEndpoint(request, false, async (identity) =>
    readDeletionRequests(identity, {}, (await params).id),
  );
}
