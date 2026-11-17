import "server-only";
import { isIP } from "node:net";
import { getSiteUrl } from "../../lib/siteUrl.ts";
import { readAuthBody } from "../auth/http.ts";
import { StaffAuthError } from "../auth/errors.ts";
import { attemptKey } from "../auth/limiter.ts";
import { sourceKeys, type TrafficSource } from "./source.ts";
import { incrementDetailView } from "./repository.ts";

export async function recordDetailView(request: Request) {
  const origin = getSiteUrl();
  if (
    request.headers.get("origin") !== origin.origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new StaffAuthError(403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new StaffAuthError(400);
  const body = await readAuthBody(request);
  if (
    Object.keys(body).some(
      (key) => !["jobId", "locale", "source"].includes(key),
    ) ||
    typeof body.jobId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      body.jobId,
    ) ||
    !["en", "zh"].includes(String(body.locale)) ||
    typeof body.source !== "string" ||
    !(sourceKeys as readonly string[]).includes(body.source)
  )
    throw new StaffAuthError(400);
  const header = process.env.AUTH_TRUSTED_IP_HEADER;
  if (
    header &&
    !["x-vercel-forwarded-for", "cf-connecting-ip"].includes(header)
  )
    throw new StaffAuthError(503);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (!header && !local) throw new StaffAuthError(503);
  const ip = header
    ? request.headers.get(header)?.split(",")[0]?.trim()
    : "local-shared";
  if (!ip || (header && !isIP(ip))) throw new StaffAuthError(400);
  const retry = await incrementDetailView(
    body.jobId,
    String(body.locale),
    body.source as TrafficSource,
    attemptKey("detail-pv", ip),
  );
  if (retry < 0) throw new StaffAuthError(503);
  if (retry > 0) throw new StaffAuthError(429, "traffic_limited", retry);
}
