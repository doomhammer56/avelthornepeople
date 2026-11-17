import "server-only";
import { createClient } from "@supabase/supabase-js";
import { StaffAuthError } from "../../auth/errors.ts";

function safeOrigin(value: string | undefined) {
  try {
    const url = new URL(value ?? "");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new StaffAuthError(503);
  }
}

export function authConfig(env: NodeJS.ProcessEnv = process.env) {
  const url = safeOrigin(env.SUPABASE_URL);
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  if (!key || key.startsWith("sb_secret_")) throw new StaffAuthError(503);
  if (!key.startsWith("sb_publishable_")) {
    try {
      if (
        JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
          .role !== "anon"
      )
        throw new Error();
    } catch {
      throw new StaffAuthError(503);
    }
  }
  return { url, key };
}

export function appOrigin(env: NodeJS.ProcessEnv = process.env) {
  return safeOrigin(env.AUTH_APP_ORIGIN);
}

export function requireCaptchaConfiguration() {
  const key = process.env.AUTH_TURNSTILE_SITE_KEY;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(appOrigin()).hostname,
  );
  if (!key || key.length > 128 || (!local && /^[123]x0+/.test(key)))
    throw new StaffAuthError(503);
}

export const authFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });

export function identityClient() {
  const { url, key } = authConfig();
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: authFetch },
  });
}
