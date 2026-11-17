import { revalidateTag } from "next/cache";
import { authorizeJobCron } from "@/server/jobs/expiry";
import { authErrorResponse, privateHeaders } from "@/server/auth/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public listings are cached for 30 seconds, but a stale entry is still served once
// after that while it refreshes. Writes made through this deployment expire the cache
// immediately; changes made anywhere else (a local import, the seed script, SQL, another
// deployment on the same database) never reach it. Expiring on a schedule bounds how long
// visitors can see an old vacancy list to the cron interval, not to the next traffic spike.
export async function GET(request: Request) {
  try {
    authorizeJobCron(request);
    revalidateTag("public-jobs", { expire: 0 });
    revalidateTag("company-content", { expire: 0 });
    return Response.json({ refreshed: true }, { headers: privateHeaders });
  } catch (error) {
    return authErrorResponse(error);
  }
}
