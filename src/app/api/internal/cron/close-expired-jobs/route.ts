import { revalidateTag } from "next/cache";
import { authorizeJobCron, closeExpiredJobs } from "@/server/jobs/expiry";
import { authErrorResponse, privateHeaders } from "@/server/auth/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: Request) {
  try {
    authorizeJobCron(request);
    const result = await closeExpiredJobs();
    if (result.processed > 0) revalidateTag("public-jobs", { expire: 0 });
    console.info("job_expiry_complete", result);
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    return authErrorResponse(error);
  }
}
