import "server-only";
import type pg from "pg";
import { withRuntime } from "../database/runtime.ts";
import type { StaffIdentity } from "./identity.ts";
import { StaffAuthError } from "./errors.ts";
import {
  isStaffRole,
  rolesFor,
  type Permission,
  type StaffRole,
} from "../../lib/auth/permissions.ts";

export type { StaffRole } from "../../lib/auth/permissions.ts";
export type Staff = { id: string; displayName: string; role: StaffRole };
export async function staffInTransaction(
  db: pg.PoolClient,
  identity: StaffIdentity,
  allowed?: readonly StaffRole[],
): Promise<Staff> {
  const result = await db.query(
    `WITH admission AS MATERIALIZED (
      SELECT portal_private.staff_session_is_admitted($1::uuid) live
    ) SELECT admission.live,p.id,p.display_name,p.role
      FROM admission LEFT JOIN portal.staff_profiles p
        ON admission.live AND p.id=$2::uuid AND p.active`,
    [identity.sessionId, identity.subject],
  );
  const row = result.rows[0];
  if (!row?.live) throw new StaffAuthError(401);
  if (
    !row.id ||
    !isStaffRole(row.role) ||
    (allowed && !allowed.includes(row.role))
  )
    throw new StaffAuthError(403);
  return { id: row.id, displayName: row.display_name, role: row.role };
}
export function requirePermission(
  identity: StaffIdentity,
  permission: Permission,
) {
  return requireStaff(identity, rolesFor(permission));
}
export async function requireStaff(
  identity: StaffIdentity,
  allowed?: readonly StaffRole[],
) {
  return withRuntime(
    identity.subject,
    (db) => staffInTransaction(db, identity, allowed),
    undefined,
    identity.sessionId,
  );
}
