import type { NextRequest } from "next/server";
import { recruitmentEndpoint } from "@/server/applications/http";
import { readCandidate } from "@/server/candidates/service";
import { listApplications } from "@/server/applications/service";
import { pagination } from "@/server/applications/contract";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  return recruitmentEndpoint(request, false, async (identity) => {
    const { candidateId } = await params;
    const query = pagination
      .strict()
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    return {
      candidate: await readCandidate(identity, candidateId),
      history: await listApplications(identity, { ...query, candidateId }),
    };
  });
}
