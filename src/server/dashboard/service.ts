import { rolesFor } from "../../lib/auth/permissions.ts";
import "server-only";
import { withRuntime } from "../database/runtime.ts";
import { staffInTransaction } from "../auth/staff.ts";
import type { StaffIdentity } from "../auth/identity.ts";
import { dashboardPeriod, type DashboardRange } from "./contract.ts";
import { readDashboard } from "./repository.ts";

export async function getDashboard(
  identity: StaffIdentity,
  range: DashboardRange,
) {
  return withRuntime(
    identity.subject,
    async (db) => {
      await staffInTransaction(db, identity, rolesFor("dashboard.read"));
      const {
        rows: [clock],
      } = await db.query("SELECT statement_timestamp() AS now");
      const result = await readDashboard(
        db,
        dashboardPeriod(range, new Date(clock.now)),
      );
      // Do not return a snapshot if admission/role changed while reading it.
      await staffInTransaction(db, identity, rolesFor("dashboard.read"));
      return result;
    },
    undefined,
    identity.sessionId,
  );
}
