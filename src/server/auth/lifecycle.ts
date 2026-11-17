import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { authAdminClient } from "../adapters/auth/admin.ts";
import { appOrigin } from "../adapters/auth/config.ts";
import type { StaffRole } from "../../lib/auth/permissions.ts";
import { UUID } from "../adapters/storage/cv-storage.ts";
import { withRuntime } from "../database/runtime.ts";
import { StaffAuthError } from "./errors.ts";
import { staffConfirmUrl } from "./emailLinks.ts";
import { mailConfigured, sendMail } from "../mail/transport.ts";
import { staffInviteEmail } from "../mail/staffEmails.ts";
import { requireStaff, staffInTransaction } from "./staff.ts";
import type { StaffIdentity } from "./identity.ts";
import { staffCommand } from "../team/contract.ts";
import { rolesFor } from "../../lib/auth/permissions.ts";

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw new StaffAuthError(400);
  return value;
}

// Derives a stable secondary requestId from a primary one so the follow-up
// role-change command is idempotent across retries of the same invite/link.
function deriveRequestId(id: string): string {
  const hex = id.replace(/-/g, "");
  const flipped =
    hex.slice(0, 30) +
    (parseInt(hex.slice(30, 32), 16) ^ 0xff).toString(16).padStart(2, "0");
  return `${flipped.slice(0, 8)}-${flipped.slice(8, 12)}-${flipped.slice(12, 16)}-${flipped.slice(16, 20)}-${flipped.slice(20)}`;
}

// Applies the role (and optionally activation) chosen in the invite dialog to a
// brand-new profile, which always starts at version 1, inactive and Read-only.
// The outcome is reported back instead of swallowed: when it could not be applied
// the member still exists with the safe defaults and the admin is told to review
// them in Manage Access, rather than being shown a false success.
async function applyInitialAccess(
  identity: StaffIdentity,
  userId: string,
  role: StaffRole | undefined,
  active: boolean | undefined,
  requestId: string,
) {
  const wantedRole = role ?? "READ_ONLY";
  const wantedActive = active ?? false;
  if (wantedRole === "READ_ONLY" && !wantedActive)
    return { role: wantedRole, active: false, accessApplied: true };
  try {
    const result = await withRuntime(
      identity.subject,
      async (db) =>
        (
          await db.query(
            "SELECT portal_private.manage_team_change($1::uuid,$2,$3,$4,$5::uuid) AS result",
            [userId, 1, wantedRole, wantedActive, deriveRequestId(requestId)],
          )
        ).rows[0].result as { operationId: string | null },
      undefined,
      identity.sessionId,
    );
    if (!result.operationId)
      return { role: wantedRole, active: wantedActive, accessApplied: true };
    // Activation queues a provider unban. Complete it now so the member can
    // sign in as soon as they have a password; if it cannot finish, the
    // account shows "Sync pending" and can be retried from Accounts.
    try {
      await reconcileStaffProviderOperation(identity, result.operationId);
      return {
        role: wantedRole,
        active: wantedActive,
        accessApplied: true,
        providerSync: "complete" as const,
      };
    } catch {
      return {
        role: wantedRole,
        active: wantedActive,
        accessApplied: true,
        providerSync: "pending" as const,
        operationId: result.operationId,
      };
    }
  } catch {
    return { role: "READ_ONLY" as const, active: false, accessApplied: false };
  }
}
const reconciliationDependencies = {
  requireStaff,
  withRuntime,
  staffInTransaction,
  authAdminClient,
};
export async function reconcileStaffProviderOperation(
  identity: StaffIdentity,
  id: string,
  dependencies = reconciliationDependencies,
) {
  uuid(id);
  await dependencies.requireStaff(identity, rolesFor("team.manage"));
  const claimId = randomUUID();
  const op = await dependencies.withRuntime(
    identity.subject,
    async (db) => {
      await dependencies.staffInTransaction(
        db,
        identity,
        rolesFor("team.manage"),
      );
      return (
        await db.query(
          "SELECT * FROM portal_private.claim_staff_provider_operation($1::uuid,$2::uuid)",
          [id, claimId],
        )
      ).rows[0];
    },
    undefined,
    identity.sessionId,
  );
  if (!op || !["claimed", "pending", "complete"].includes(op.state))
    throw new StaffAuthError(503);
  if (op.state !== "claimed")
    return { operationId: id, providerSync: op.state };
  if (!UUID.test(op.profile_id) || !["ban", "unban"].includes(op.operation))
    throw new StaffAuthError(503);
  // The claim is committed and the pool connection released before Auth HTTP.
  // Never automatically steal a claim after a timeout: provider requests have
  // no fencing token and may still complete remotely after the caller gives up.
  const finish = (success: boolean) =>
    dependencies.withRuntime(
      identity.subject,
      async (db) => {
        await dependencies.staffInTransaction(
          db,
          identity,
          rolesFor("team.manage"),
        );
        await db.query(
          "SELECT portal_private.finish_staff_provider_claim($1::uuid,$2::uuid,$3::boolean)",
          [id, claimId, success],
        );
      },
      undefined,
      identity.sessionId,
    );
  let provider: ReturnType<typeof authAdminClient>;
  try {
    provider = dependencies.authAdminClient();
  } catch {
    // Configuration failure before invoking the provider is known not to have
    // sent a write, so it is safe to release the claim for a later retry.
    await finish(false);
    throw new StaffAuthError(503);
  }
  const { error } = await provider.auth.admin.updateUserById(op.profile_id, {
    ban_duration: op.operation === "ban" ? "876000h" : "none",
  });
  const definitiveRejection =
    error && [400, 401, 403, 404, 422, 429].includes(error.status ?? 0);
  if (error && !definitiveRejection) throw new StaffAuthError(503);
  await finish(!error);
  if (error) throw new StaffAuthError(503);
  return { operationId: id, providerSync: "complete" };
}

export async function manageStaff(identity: StaffIdentity, input: unknown) {
  await requireStaff(identity, rolesFor("team.manage"));
  const body = staffCommand.parse(input);
  const requestId = body.requestId;
  if (body.action === "reconcile")
    return reconcileStaffProviderOperation(identity, uuid(body.operationId));
  if (body.action === "link") {
    const target = body.userId;
    const displayName = body.displayName;
    const verified = await authAdminClient().auth.admin.getUserById(target);
    if (verified.error || verified.data.user?.id !== target)
      throw new StaffAuthError(400);
    await withRuntime(
      identity.subject,
      async (db) => {
        await db.query(
          "SELECT portal_private.link_staff($1::uuid,$2,$3::uuid)",
          [target, displayName, requestId],
        );
      },
      undefined,
      identity.sessionId,
    );
    const access = await applyInitialAccess(
      identity,
      target,
      body.role,
      body.active,
      requestId,
    );
    return { userId: target, ...access };
  }
  if (body.action === "invite") {
    const email = body.email;
    const displayName = body.displayName;
    const secret = process.env.AUTH_LIMITER_SECRET;
    if (!secret || secret.length < 32) throw new StaffAuthError(503);
    const hash = createHmac("sha256", secret)
      .update(email.toLowerCase())
      .digest();
    const reservation = await withRuntime(
      identity.subject,
      async (db) =>
        (
          await db.query(
            "SELECT * FROM portal_private.reserve_staff_invitation($1::uuid,$2)",
            [requestId, hash],
          )
        ).rows[0],
      undefined,
      identity.sessionId,
    );
    // Already completed by an earlier identical request: report it, never resend.
    if (!reservation.reserved && reservation.profile_id)
      return { userId: reservation.profile_id };
    // Reserved earlier but never completed (the provider call or mail failed).
    // Generating a link for a still-unconfirmed account is idempotent, so the
    // same request can safely continue instead of being stuck behind a 409.
    const origin = appOrigin();
    const lang = body.lang ?? "en";
    const provider = authAdminClient();
    let target: string;
    let setupUrl: string | null = null;
    if (mailConfigured()) {
      // Build the link ourselves so it always targets /auth/confirm?token_hash=…
      // and never depends on how the provider's email template is configured.
      const { data, error } = await provider.auth.admin.generateLink({
        type: "invite",
        email,
        options: { redirectTo: `${origin}/auth/confirm` },
      });
      if (error) {
        const registered =
          error.code === "email_exists" || error.status === 422;
        throw registered
          ? new StaffAuthError(409, "email_exists")
          : new StaffAuthError(503);
      }
      if (!data?.user?.id || !data.properties?.hashed_token)
        throw new StaffAuthError(503);
      target = data.user.id;
      setupUrl = staffConfirmUrl(
        origin,
        data.properties.hashed_token,
        "invite",
        lang,
      );
    } else {
      // No SMTP configured here: fall back to the provider's invitation email,
      // which needs the repository's invite template installed in Supabase.
      const result = await provider.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${origin}/auth/confirm`,
      });
      if (result.error) {
        const registered =
          result.error.code === "email_exists" || result.error.status === 422;
        throw registered
          ? new StaffAuthError(409, "email_exists")
          : new StaffAuthError(503);
      }
      if (!result.data.user?.id) throw new StaffAuthError(503);
      target = result.data.user.id;
    }
    await withRuntime(
      identity.subject,
      async (db) => {
        await db.query(
          "SELECT portal_private.complete_staff_invitation($1::uuid,$2::uuid,$3)",
          [requestId, target, displayName],
        );
      },
      undefined,
      identity.sessionId,
    );
    const access = await applyInitialAccess(
      identity,
      target,
      body.role,
      body.active,
      requestId,
    );
    let emailSent = true;
    if (setupUrl) {
      try {
        await sendMail({
          to: email,
          ...staffInviteEmail(lang, email, displayName, setupUrl, origin),
        });
      } catch {
        // The member and their access exist; only delivery failed. Say so, so
        // the admin can resend from Accounts instead of seeing a bare error.
        emailSent = false;
      }
    }
    return { userId: target, ...access, emailSent };
  }
  if (body.action === "delete") {
    const target = body.userId;
    await withRuntime(
      identity.subject,
      async (db) => {
        await db.query(
          "SELECT portal_private.delete_staff($1::uuid,$2,$3::uuid)",
          [target, body.expectedVersion, requestId],
        );
      },
      undefined,
      identity.sessionId,
    );
    // The profile is gone and a deactivated member was already banned, so they
    // cannot reach the console even if removing the sign-in account fails here.
    let providerDeleted = true;
    try {
      const { error } = await authAdminClient().auth.admin.deleteUser(target);
      if (error && error.status !== 404) providerDeleted = false;
    } catch {
      providerDeleted = false;
    }
    return { userId: target, deleted: true, providerDeleted };
  }
  const target = body.userId;
  const result = await withRuntime(
    identity.subject,
    async (db) =>
      (
        await db.query(
          "SELECT portal_private.manage_team_change($1::uuid,$2,$3,$4,$5::uuid) AS result",
          [target, body.expectedVersion, body.role, body.active, requestId],
        )
      ).rows[0].result as {
        userId: string;
        version: number;
        operationId: string | null;
      },
    undefined,
    identity.sessionId,
  );
  const operationId = result.operationId;
  if (!operationId)
    return {
      userId: target,
      version: result.version,
      providerSync: "complete",
    };
  try {
    return {
      userId: target,
      version: result.version,
      ...(await reconcileStaffProviderOperation(identity, operationId)),
    };
  } catch {
    return {
      userId: target,
      version: result.version,
      operationId,
      providerSync: "pending",
    };
  }
}
