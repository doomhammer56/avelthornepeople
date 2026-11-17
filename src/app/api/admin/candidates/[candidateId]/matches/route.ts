import type { NextRequest } from "next/server";
import { recruitmentEndpoint } from "@/server/applications/http";
import { readMatches } from "@/server/candidates/service";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  return recruitmentEndpoint(request, false, async (identity) =>
    readMatches(
      identity,
      (await params).candidateId,
      Object.fromEntries(request.nextUrl.searchParams),
    ),
  );
}
