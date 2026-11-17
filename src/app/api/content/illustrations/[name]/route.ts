import { companyIllustrationResponse } from "@/server/content/illustrations";
import { contentErrorResponse } from "@/server/content/http";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    return await companyIllustrationResponse((await params).name);
  } catch (error) {
    return contentErrorResponse(error);
  }
}
