import "server-only";
import type { StaffIdentity } from "../auth/identity.ts";
import { StaffAuthError } from "../auth/errors.ts";
import { staffRead } from "../admin/read.ts";
import {
  rolesFor,
  isStaffRole,
  roleScope,
} from "../../lib/auth/permissions.ts";
import type { TeamAccount } from "./contract.ts";
const teamDependencies = { staffRead };

export async function readStaffAccounts(
  identity: StaffIdentity,
  page = 1,
  dependencies = teamDependencies,
) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
    throw new StaffAuthError(400);
  try {
    return await dependencies.staffRead(
      identity,
      rolesFor("team.read"),
      async (db) => {
        const { rows } = await db.query(
          "SELECT * FROM portal_private.read_staff_accounts($1::integer)",
          [page],
        );
        const accounts = rows.slice(0, 50).map((row): TeamAccount => {
          const role = row.role;
          if (row.provider_id !== row.id || !isStaffRole(role))
            throw new StaffAuthError(503);
          const at =
            row.last_sign_in_at == null
              ? "—"
              : new Date(row.last_sign_in_at).toISOString();
          return {
            id: row.id,
            name: row.display_name,
            email: row.email ?? "",
            role,
            active: row.active,
            version: Number(row.version),
            pendingOperationId: row.pending_operation_id ?? null,
            scope: roleScope[role],
            lastLogin: { en: at, zh: at },
          };
        });
        return { accounts, page, hasMore: rows.length > 50 };
      },
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42501"
    )
      throw new StaffAuthError(403);
    throw error;
  }
}
