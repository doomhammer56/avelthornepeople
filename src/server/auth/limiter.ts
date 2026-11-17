import "server-only";
import { createHmac } from "node:crypto";
import { withRuntime } from "../database/runtime.ts";
import { StaffAuthError } from "./errors.ts";

export function attemptKey(
  scope: string,
  value: string,
  secret = process.env.AUTH_LIMITER_SECRET,
) {
  if (!secret || secret.length < 32) throw new StaffAuthError(503);
  const hex = createHmac("sha256", secret)
    .update(`${scope}\0${value}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function limitAuthAttempt(request: Request, email?: string) {
  const header = process.env.AUTH_TRUSTED_IP_HEADER;
  if (
    header &&
    !["x-vercel-forwarded-for", "cf-connecting-ip"].includes(header)
  )
    throw new StaffAuthError(503);
  const ip = header
    ? request.headers.get(header)?.split(",")[0]?.trim()
    : "local-shared";
  if (!ip || ip.length > 64) throw new StaffAuthError(400);
  // Commit a denied attempt too: returning a boolean prevents rollback bypasses.
  const retry = await withRuntime(null, async (db) => {
    const ipResult = await db.query(
      "SELECT portal_private.consume_login_traffic($1::uuid,'ip') AS retry",
      [attemptKey("ip", ip)],
    );
    if (ipResult.rows[0].retry || !email) return ipResult.rows[0].retry;
    return (
      await db.query(
        "SELECT portal_private.consume_login_traffic($1::uuid,'account') AS retry",
        [attemptKey("recovery", email.trim().toLowerCase())],
      )
    ).rows[0].retry;
  });
  if (retry) throw new StaffAuthError(429, "traffic_limited", retry);
}
