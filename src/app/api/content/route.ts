import type { NextRequest } from "next/server";
import { z } from "zod";
import { contentTypes } from "@/lib/content/contract";
import { publishedContent } from "@/server/content/service";
import { contentErrorResponse } from "@/server/content/http";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const query = z
      .object({
        locale: z.enum(["en", "zh"]).default("en"),
        type: z.enum(contentTypes).optional(),
      })
      .strict()
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    return Response.json(
      { blocks: await publishedContent(query.locale, query.type) },
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Language": query.locale,
        },
      },
    );
  } catch (error) {
    return contentErrorResponse(error);
  }
}
