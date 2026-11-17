import "server-only";
import { currentStaffIdentity } from "../../server/auth/pages.ts";
import { getDashboard } from "../../server/dashboard/service.ts";
import type {
  DashboardMetrics,
  DashboardRange,
} from "../../server/dashboard/contract.ts";
export type { DashboardMetrics, DashboardRange };
export async function getDashboardMetrics(range: DashboardRange) {
  return { metrics: await getDashboard(await currentStaffIdentity(), range) };
}
