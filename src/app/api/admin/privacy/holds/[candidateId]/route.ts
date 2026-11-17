import type { NextRequest } from "next/server";
import { privacyEndpoint, privacyBody } from "@/server/privacy/http";
import { manageLegalHold } from "@/server/privacy/service";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  return privacyEndpoint(request, true, async (identity) =>
    manageLegalHold(
      identity,
      (await params).candidateId,
      await privacyBody(request),
    ),
  );
}
