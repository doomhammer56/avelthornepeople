import type { NextRequest } from "next/server";
import { contentEndpoint, contentBody } from "@/server/content/http";
import { manageContent } from "@/server/content/service";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return contentEndpoint(request, true, async (identity) =>
    manageContent(
      identity,
      "action",
      (await params).id,
      await contentBody(request),
    ),
  );
}
