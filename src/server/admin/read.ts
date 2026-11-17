import "server-only";
import type pg from "pg";
import type { StaffIdentity } from "../auth/identity.ts";
import {
  staffInTransaction,
  type StaffRole,
  type Staff,
} from "../auth/staff.ts";
import { withRuntime } from "../database/runtime.ts";

export function staffRead<T>(
  identity: StaffIdentity,
  roles: readonly StaffRole[],
  action: (db: pg.PoolClient, staff: Staff) => Promise<T>,
  connectionPool?: pg.Pool,
) {
  return withRuntime(
    identity.subject,
    async (db) => {
      const staff = await staffInTransaction(db, identity, roles);
      const result = await action(db, staff);
      await staffInTransaction(db, identity, roles);
      return result;
    },
    connectionPool,
    identity.sessionId,
  );
}
