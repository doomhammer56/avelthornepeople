import { contentImageResponse } from "@/server/content/images";
import { contentErrorResponse } from "@/server/content/http";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await contentImageResponse((await params).id);
  } catch (error) {
    return contentErrorResponse(error);
  }
}
