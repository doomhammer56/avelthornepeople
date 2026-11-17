import type { NextRequest } from "next/server";
import {
  recruitmentEndpoint,
  recruitmentBody,
} from "@/server/applications/http";
import { mergeCandidates } from "@/server/candidates/service";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  return recruitmentEndpoint(request, true, async (identity) =>
    mergeCandidates(
      identity,
      (await params).candidateId,
      await recruitmentBody(request),
    ),
  );
}
