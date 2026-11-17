import "server-only";
import { currentStaffIdentity } from "../../server/auth/pages.ts";
import { readAudit } from "../../server/audit/service.ts";
export async function getAdminAuditLog(filters: unknown = {}) {
  return readAudit(await currentStaffIdentity(), filters);
}
