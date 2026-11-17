import "server-only";

export class StaffAuthError extends Error {
  readonly status: 400 | 401 | 403 | 409 | 429 | 503;
  readonly code?:
    | "login_locked"
    | "login_busy"
    | "traffic_limited"
    | "provider_limited"
    | "captcha_failed"
    | "invalid_login"
    | "email_link_invalid"
    | "password_weak"
    | "password_reused"
    | "password_reset_required"
    | "email_exists"
    | "has_records";
  readonly retryAfterSeconds?: number;
  constructor(
    status: 400 | 401 | 403 | 409 | 429 | 503,
    code?: StaffAuthError["code"],
    retryAfterSeconds?: number,
  ) {
    super(
      status === 503
        ? "Authentication temporarily unavailable"
        : "Request not permitted",
    );
    this.status = status;
    this.code = code;
    this.retryAfterSeconds =
      retryAfterSeconds === undefined
        ? undefined
        : Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

export const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  Pragma: "no-cache",
  Expires: "0",
};

export function authErrorResponse(error: unknown) {
  const status = error instanceof StaffAuthError ? error.status : 503;
  const detail = error instanceof StaffAuthError ? error : undefined;
  return Response.json(
    {
      ...(detail?.code ? { code: detail.code } : {}),
      ...(detail?.retryAfterSeconds
        ? { retryAfterSeconds: detail.retryAfterSeconds }
        : {}),
      error:
        status === 503
          ? "Authentication temporarily unavailable"
          : "Request not permitted",
    },
    {
      status,
      headers: {
        ...privateHeaders,
        ...(detail?.retryAfterSeconds
          ? { "Retry-After": String(detail.retryAfterSeconds) }
          : {}),
      },
    },
  );
}
