import { requestCandidateDeletion } from "@/server/privacy/public";
import { privacyErrorResponse } from "@/server/privacy/http";
import { privateHeaders } from "@/server/auth/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return Response.json(await requestCandidateDeletion(request), {
      status: 202,
      headers: privateHeaders,
    });
  } catch (error) {
    return privacyErrorResponse(error);
  }
}
