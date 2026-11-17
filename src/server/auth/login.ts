import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRuntime } from "../database/runtime.ts";
import { attemptKey } from "./limiter.ts";
import { StaffAuthError } from "./errors.ts";
import { verifyIdentity, type StaffIdentity } from "./identity.ts";

type Decision = {
  outcome: string;
  retry_after_seconds: number;
  reservation_id?: string;
};
export type LoginRepository = {
  begin: (key: string) => Promise<Decision>;
  finish: (
    key: string,
    ticket: string,
    outcome: "invalid" | "abort" | "success",
    identity?: StaffIdentity,
  ) => Promise<Decision>;
};
export const loginRepository: LoginRepository = {
  begin: (key) =>
    withRuntime(
      null,
      async (db) =>
        (
          await db.query(
            "SELECT * FROM portal_private.begin_staff_login($1::uuid)",
            [key],
          )
        ).rows[0],
    ),
  finish: (key, ticket, outcome, identity) =>
    withRuntime(
      identity?.subject ?? null,
      async (db) =>
        (
          await db.query(
            "SELECT * FROM portal_private.finish_staff_login($1::uuid,$2::uuid,$3,$4::uuid)",
            [key, ticket, outcome, identity?.sessionId ?? null],
          )
        ).rows[0],
      undefined,
      identity?.sessionId,
    ),
};

export function passwordError(error: { code?: string; status?: number }) {
  if (!error.status || error.status >= 500) return new StaffAuthError(503);
  if (error.status === 429) return new StaffAuthError(429, "provider_limited");
  if (error.code === "captcha_failed")
    return new StaffAuthError(400, "captcha_failed");
  return new StaffAuthError(401, "invalid_login");
}

// The supplied client must have isolated, buffered cookies. Publish them only
// after this function returns, when the admission transaction has committed.
export async function loginStaff(
  client: Pick<SupabaseClient, "auth">,
  input: { email: string; password: string; captchaToken: string },
  clearCookies: () => void,
  repository = loginRepository,
  identify = verifyIdentity,
) {
  const email = input.email.trim().toLowerCase();
  const key = attemptKey("login", email);
  const start = await repository.begin(key);
  if (start.outcome === "locked")
    throw new StaffAuthError(429, "login_locked", start.retry_after_seconds);
  if (start.outcome === "busy")
    throw new StaffAuthError(429, "login_busy", start.retry_after_seconds);
  if (start.outcome !== "ready" || !start.reservation_id)
    throw new StaffAuthError(503);
  const ticket = start.reservation_id;
  let provisional = false;
  let finalized = false;
  try {
    const result = await client.auth.signInWithPassword({
      email,
      password: input.password,
      options: { captchaToken: input.captchaToken },
    });
    provisional = !!result.data.session;
    if (result.error) {
      // Never count CAPTCHA, provider throttling, outages or unrelated 4xx.
      const invalid =
        result.error.code === "invalid_credentials" &&
        !!result.error.status &&
        result.error.status < 500 &&
        result.error.status !== 429;
      const end = await repository.finish(
        key,
        ticket,
        invalid ? "invalid" : "abort",
      );
      finalized = true;
      if (end.outcome === "stale") throw new StaffAuthError(503);
      if (end.outcome === "locked")
        throw new StaffAuthError(429, "login_locked", end.retry_after_seconds);
      throw passwordError(result.error);
    }
    if (!result.data.session) throw new StaffAuthError(503);
    const identity = await identify(result.data.session.access_token);
    const end = await repository.finish(key, ticket, "success", identity);
    finalized = true;
    if (end.outcome !== "admitted")
      throw new StaffAuthError(
        end.outcome === "denied" ? 401 : 503,
        "invalid_login",
      );
  } catch (error) {
    if (provisional)
      await client.auth.signOut({ scope: "local" }).catch(() => {});
    clearCookies();
    if (!finalized)
      await repository.finish(key, ticket, "abort").catch(() => {});
    throw error;
  }
}
