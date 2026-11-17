import type { NextRequest } from "next/server";
import { contentEndpoint, contentBody } from "@/server/content/http";
import { readContent, manageContent } from "@/server/content/service";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  return contentEndpoint(request, false, (identity) => readContent(identity));
}
export async function POST(request: NextRequest) {
  return contentEndpoint(request, true, async (identity) =>
    manageContent(identity, "create", undefined, await contentBody(request)),
  );
}
