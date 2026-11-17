import type { NextRequest } from "next/server";
import { privacyEndpoint, privacyBody } from "@/server/privacy/http";
import { decideDeletionRequest } from "@/server/privacy/service";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return privacyEndpoint(request, true, async (identity) =>
    decideDeletionRequest(
      identity,
      (await params).id,
      await privacyBody(request),
    ),
  );
}
