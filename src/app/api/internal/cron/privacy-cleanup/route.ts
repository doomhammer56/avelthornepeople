import { authorizeJobCron } from "@/server/jobs/expiry";
import { authErrorResponse, privateHeaders } from "@/server/auth/errors";
import { processPrivacyCleanup } from "@/server/privacy/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    authorizeJobCron(request);
    const result = await processPrivacyCleanup();
    return Response.json(result, {
      status: result.failed ? 503 : 200,
      headers: privateHeaders,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
