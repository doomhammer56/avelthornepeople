import "server-only";
import { privateHeaders, StaffAuthError } from "../auth/errors.ts";
import { recruitmentError } from "../applications/errors.ts";

export function privacyErrorResponse(error: unknown) {
  return Response.json(
    { error: "Privacy request could not be processed" },
    {
      status: recruitmentError(error),
      headers: {
        ...privateHeaders,
        ...(error instanceof StaffAuthError && error.retryAfterSeconds
          ? { "Retry-After": String(error.retryAfterSeconds) }
          : {}),
      },
    },
  );
}
