import type { NextRequest } from "next/server";
import { contentEndpoint } from "@/server/content/http";
import { contentImageResponse } from "@/server/content/images";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return contentEndpoint(request, false, async (identity) =>
    contentImageResponse((await params).id, identity),
  );
}
