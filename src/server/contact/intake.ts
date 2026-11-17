import "server-only";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { getSiteUrl, matchesSiteOrigin } from "../../lib/siteUrl.ts";
import { withRuntime } from "../database/runtime.ts";
import { readAuthBody } from "../auth/http.ts";
import { attemptKey } from "../auth/limiter.ts";
import { StaffAuthError, privateHeaders } from "../auth/errors.ts";
import {
  encryptProfileValue,
  ProfileUnavailable,
} from "../candidates/crypto.ts";

const contactRequest = z
  .object({
    name: z.string().trim().min(1).max(120),
    company: z.string().trim().max(160),
    email: z.string().trim().pipe(z.email().max(254)),
    message: z.string().trim().min(1).max(5000),
    locale: z.enum(["en", "zh"]),
  })
  .strict();

async function prepareContactRequest(request: Request) {
  if (
    !matchesSiteOrigin(request.headers.get("origin")) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new StaffAuthError(403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new StaffAuthError(400);

  const header = process.env.AUTH_TRUSTED_IP_HEADER;
  if (
    header &&
    !["x-vercel-forwarded-for", "cf-connecting-ip"].includes(header)
  )
    throw new StaffAuthError(503);
  const origin = getSiteUrl();
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (!header && !local) throw new StaffAuthError(503);
  const ip = header
    ? request.headers.get(header)?.split(",")[0]?.trim()
    : "local-shared";
  if (!ip || (header && !isIP(ip))) throw new StaffAuthError(400);

  const retry = await withRuntime(null, async (db) =>
    (
      await db.query(
        "SELECT portal_private.consume_intake_traffic($1::uuid) retry",
        [attemptKey("contact-intake", ip)],
      )
    ).rows[0].retry,
  );
  if (retry) throw new StaffAuthError(429, "traffic_limited", Number(retry));

  return contactRequest.parse(await readAuthBody(request));
}

export async function receiveContactMessage(request: Request) {
  const input = await prepareContactRequest(request);
  const id = randomUUID();
  const senderEncrypted = encryptProfileValue(
    {
      name: input.name,
      email: input.email,
      company: input.company,
    },
    `contact:${id}:sender`,
  );
  const bodyEncrypted = encryptProfileValue(
    { message: input.message },
    `contact:${id}:body`,
  );

  await withRuntime(null, (db) =>
    db.query("SELECT portal_private.receive_contact_message($1,$2,$3,$4)", [
      id,
      senderEncrypted,
      bodyEncrypted,
      input.locale,
    ]),
  );

  return { accepted: true as const };
}

export function contactErrorResponse(error: unknown) {
  const status =
    error instanceof StaffAuthError
      ? error.status
      : error instanceof z.ZodError ||
          (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "22023")
        ? 400
        : error instanceof ProfileUnavailable
          ? 503
          : 503;

  return Response.json(
    {
      error:
        status === 400
          ? "Contact message could not be accepted"
          : "Contact service unavailable",
      ...(error instanceof StaffAuthError && error.code
        ? { code: error.code }
        : {}),
      ...(error instanceof StaffAuthError && error.retryAfterSeconds
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    },
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
