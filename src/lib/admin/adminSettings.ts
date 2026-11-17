import "server-only";
import { currentStaffIdentity } from "../../server/auth/pages.ts";
import type { ReferenceItem } from "./referenceData";
import { readAdminSettings } from "../../server/admin/queries.ts";
export type AdminSettings = {
  departments: ReferenceItem[];
  locations: ReferenceItem[];
  jobTypes: ReferenceItem[];
  experienceLevels: ReferenceItem[];
};
export async function getAdminSettings(): Promise<AdminSettings> {
  return readAdminSettings(await currentStaffIdentity());
}
