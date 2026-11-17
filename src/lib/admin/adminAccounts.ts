import "server-only";
import { currentStaffIdentity } from "../../server/auth/pages.ts";
import { readStaffAccounts } from "../../server/team/service.ts";
export type { TeamAccount as AdminAccount } from "../../server/team/contract.ts";

export async function getAdminAccounts(page = 1) {
  return readStaffAccounts(await currentStaffIdentity(), page);
}
