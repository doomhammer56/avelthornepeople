import "server-only";
import { appOrigin } from "../adapters/auth/config.ts";
import { StaffAuthError } from "./errors.ts";
import { can, type StaffRole } from "../../lib/auth/permissions.ts";

export const AUTH_LANGUAGE_COOKIE = "portal-auth-language";
export const authLang = (value: unknown): "en" | "zh" =>
  value === "zh" ? "zh" : "en";

export function assertSameOrigin(request: Request) {
  if (
    request.headers.get("origin") !== appOrigin() ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new StaffAuthError(403);
}

export function safeConsolePath(value: string | null | undefined) {
  if (!value || value.length > 512 || /[\\\s%#]/.test(value)) return "/admin";
  try {
    const url = new URL(value, "https://console.invalid");
    if (
      !value.startsWith("/admin") ||
      url.origin !== "https://console.invalid" ||
      !/^\/admin(?:\/|$)/.test(url.pathname) ||
      /^\/admin\/(login|forgot-password|reset-password|setup-password|denied)(?:\/|$)/.test(
        url.pathname,
      )
    )
      return "/admin";
    return url.pathname + url.search;
  } catch {
    return "/admin";
  }
}

export function staffConsolePath(
  value: string | undefined,
  role: StaffRole,
  lang: "en" | "zh",
) {
  const url = new URL(safeConsolePath(value), "https://console.invalid");
  if (url.pathname === "/admin" && !can(role, "dashboard.read"))
    url.pathname = "/admin/jobs";
  if (!url.searchParams.has("lang")) url.searchParams.set("lang", lang);
  return url.pathname + url.search;
}

export async function readAuthBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new StaffAuthError(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 24_000) {
        await reader.cancel();
        throw new StaffAuthError(400);
      }
      chunks.push(value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || Array.isArray(data) || typeof data !== "object")
      throw new Error();
    return data;
  } catch {
    throw new StaffAuthError(400);
  }
}
