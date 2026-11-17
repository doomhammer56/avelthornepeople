import "server-only";
import { StaffAuthError } from "./errors.ts";

/**
 * Verify a Cloudflare Turnstile token for public intake routes.
 * Uses TURNSTILE_SECRET_KEY or AUTH_TURNSTILE_SECRET (server-only).
 * When no secret is configured, verification is skipped (local/dev only; set the secret in production).
 */
export async function assertTurnstileToken(
  token: unknown,
  request: Request,
): Promise<void> {
  const secret =
    process.env.TURNSTILE_SECRET_KEY ?? process.env.AUTH_TURNSTILE_SECRET;
  if (!secret) return;
  if (typeof token !== "string" || token.length < 1 || token.length > 4096)
    throw new StaffAuthError(400, "captcha_failed");

  const forwarded =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (forwarded) body.set("remoteip", forwarded);

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new StaffAuthError(503);
  const data = (await res.json()) as { success?: boolean };
  if (data.success !== true) throw new StaffAuthError(400, "captcha_failed");
}
