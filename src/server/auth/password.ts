import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { withRuntime } from "../database/runtime.ts";
import type { StaffIdentity } from "./identity.ts";
import { StaffAuthError } from "./errors.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { identityClient } from "../adapters/auth/config.ts";
import { loginStaff } from "./login.ts";

export const PASSWORD_COOKIE = "portal-password-setup";
export async function createPasswordGrant(identity: StaffIdentity) {
  const token = randomBytes(32).toString("base64url");
  await withRuntime(
    identity.subject,
    async (db) => {
      await db.query(
        "SELECT portal_private.create_password_grant($1::uuid,$2::bytea)",
        [identity.sessionId, createHash("sha256").update(token).digest()],
      );
    },
    undefined,
    identity.sessionId,
  );
  return token;
}
function grantHash(token: string | undefined) {
  if (!token || !/^[\w-]{43}$/.test(token))
    throw new StaffAuthError(403, "email_link_invalid");
  return createHash("sha256").update(token).digest();
}

export type PasswordRepository = {
  valid: (identity: StaffIdentity, hash: Buffer) => Promise<boolean>;
  begin: (identity: StaffIdentity, hash: Buffer) => Promise<string | null>;
  finish: (
    identity: StaffIdentity,
    hash: Buffer,
    ticket: string,
    result: "retry" | "complete" | "uncertain",
  ) => Promise<boolean>;
};
export const passwordRepository: PasswordRepository = {
  valid: (identity, hash) =>
    withRuntime(
      identity.subject,
      async (db) =>
        (
          await db.query(
            "SELECT portal_private.password_grant_is_valid($1,$2) AS allowed",
            [identity.sessionId, hash],
          )
        ).rows[0].allowed,
      undefined,
      identity.sessionId,
    ),
  begin: (identity, hash) =>
    withRuntime(
      identity.subject,
      async (db) =>
        (
          await db.query(
            "SELECT portal_private.begin_password_change($1,$2) AS ticket",
            [identity.sessionId, hash],
          )
        ).rows[0].ticket,
      undefined,
      identity.sessionId,
    ),
  finish: (identity, hash, ticket, result) =>
    withRuntime(
      identity.subject,
      async (db) =>
        (
          await db.query(
            "SELECT portal_private.finish_password_change($1,$2,$3,$4) AS allowed",
            [identity.sessionId, hash, ticket, result],
          )
        ).rows[0].allowed,
      undefined,
      identity.sessionId,
    ),
};

export async function passwordGrantIsValid(
  identity: StaffIdentity,
  token: string | undefined,
) {
  return passwordRepository.valid(identity, grantHash(token));
}

export async function updatePassword(
  client: Pick<SupabaseClient, "auth">,
  identity: StaffIdentity,
  token: string | undefined,
  password: string,
  clearCookies: () => void,
  repository = passwordRepository,
) {
  if (password.length < 12 || password.length > 256)
    throw new StaffAuthError(400, "password_weak");
  const hash = grantHash(token);
  const ticket = await repository.begin(identity, hash);
  if (!ticket) throw new StaffAuthError(403, "email_link_invalid");
  let retryable = false,
    finalized = false;
  try {
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      const safeRejection =
        !!error.status &&
        error.status < 500 &&
        (error.code === "weak_password" ||
          error.code === "same_password" ||
          error.status === 429);
      if (safeRejection) {
        retryable = await repository.finish(identity, hash, ticket, "retry");
        finalized = retryable;
        if (retryable)
          throw new StaffAuthError(
            error.status === 429 ? 429 : 400,
            error.status === 429
              ? "provider_limited"
              : error.code === "same_password"
                ? "password_reused"
                : "password_weak",
          );
      }
      throw new StaffAuthError(503, "password_reset_required");
    }
    if (!(await repository.finish(identity, hash, ticket, "complete")))
      throw new StaffAuthError(503, "password_reset_required");
    finalized = true;
    // The committed local cutoff is authoritative for staff access. Revoke
    // provider refresh sessions too; failed responses never preserve app cookies.
    await client.auth.signOut({ scope: "global" }).catch(() => {});
    clearCookies();
  } catch (error) {
    if (!retryable) {
      if (!finalized)
        await repository
          .finish(identity, hash, ticket, "uncertain")
          .catch(() => {});
      await client.auth.signOut({ scope: "global" }).catch(() => {});
      clearCookies();
    }
    throw error;
  }
}

type ChangeOwnPasswordDependencies = {
  verifier: () => Pick<SupabaseClient, "auth">;
  login: typeof loginStaff;
  grant: typeof createPasswordGrant;
  update: typeof updatePassword;
};
const changeDependencies: ChangeOwnPasswordDependencies = {
  verifier: identityClient,
  login: loginStaff,
  grant: createPasswordGrant,
  update: updatePassword,
};

// Signed-in password change. The current password is proven through the normal
// sign-in path (lockout, CAPTCHA) on a throwaway in-memory client, so wrong
// guesses count against the same limits as the login form and the caller's own
// cookies are never touched. Only then is a single-use grant minted for the
// current session and spent by the existing update flow, which records the
// audit entry, revokes every older session and signs the caller out.
export async function changeOwnPassword(
  input: {
    client: Pick<SupabaseClient, "auth">;
    identity: StaffIdentity;
    email: string;
    currentPassword: string;
    newPassword: string;
    captchaToken: string;
    clearCookies: () => void;
  },
  dependencies = changeDependencies,
) {
  const { currentPassword, newPassword } = input;
  if (newPassword.length < 12 || newPassword.length > 256)
    throw new StaffAuthError(400, "password_weak");
  if (currentPassword.length < 8 || currentPassword.length > 256)
    throw new StaffAuthError(401, "invalid_login");
  if (newPassword === currentPassword)
    throw new StaffAuthError(400, "password_reused");
  const verifier = dependencies.verifier();
  await dependencies.login(
    verifier,
    {
      email: input.email,
      password: currentPassword,
      captchaToken: input.captchaToken,
    },
    () => {},
  );
  // The proof-of-password session has served its purpose.
  await verifier.auth.signOut({ scope: "local" }).catch(() => {});
  const token = await dependencies.grant(input.identity);
  await dependencies.update(
    input.client,
    input.identity,
    token,
    newPassword,
    input.clearCookies,
  );
}
