import type { NextRequest } from "next/server";
import { contentEndpoint, boundedBody } from "@/server/content/http";
import { uploadContentImage, MAX_IMAGE_BYTES } from "@/server/content/images";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  return contentEndpoint(request, true, (identity) =>
    uploadContentImage(
      identity,
      () => boundedBody(request, MAX_IMAGE_BYTES),
      request.headers.get("content-type") ?? "",
    ),
  );
}
