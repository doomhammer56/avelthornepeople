import { recordDetailView } from "@/server/analytics/service";
import { privateHeaders, StaffAuthError } from "@/server/auth/errors";

export async function POST(request: Request) {
  try {
    await recordDetailView(request);
    return new Response(null, { status: 204, headers: privateHeaders });
  } catch (error) {
    // Best-effort analytics never returns database/provider diagnostics.
    const status = error instanceof StaffAuthError ? error.status : 503;
    return Response.json(
      { error: "View could not be recorded" },
      {
        status,
        headers: {
          ...privateHeaders,
          ...(error instanceof StaffAuthError && error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : {}),
        },
      },
    );
  }
}
