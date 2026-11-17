import type { NextRequest } from "next/server";
import { contentEndpoint, contentBody } from "@/server/content/http";
import { readContent, manageContent } from "@/server/content/service";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  return contentEndpoint(request, false, async (identity) => ({
    block: (await readContent(identity, (await params).id)).blocks[0],
  }));
}
export async function PATCH(request: NextRequest, { params }: Context) {
  return contentEndpoint(request, true, async (identity) =>
    manageContent(
      identity,
      "save",
      (await params).id,
      await contentBody(request),
    ),
  );
}
