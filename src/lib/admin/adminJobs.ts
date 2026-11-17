import "server-only";
import { currentStaffIdentity } from "../../server/auth/pages.ts";
import type { AdminJob } from "./jobFields";
import { readAdminJobs } from "../../server/admin/queries.ts";
import { listAdminJobs } from "../../server/jobs/management-read.ts";
import type { JobListQuery } from "../../server/jobs/management-contract.ts";
export type { AdminJob } from "./jobFields";
export {
  jobLabel,
  hasEnglish,
  isPastDeadline,
  blankDraftJob,
} from "./jobFields";
export async function getAdminJobs(query?: JobListQuery) {
  if (query) return listAdminJobs(await currentStaffIdentity(), query);
  const jobs = await readAdminJobs(await currentStaffIdentity());
  return {
    jobs,
    total: jobs.length,
    page: 1,
    pageSize: jobs.length,
    statusCounts: Object.fromEntries(
      ["draft", "pending", "published", "paused", "closed"].map((status) => [
        status,
        jobs.filter((job) => job.status === status).length,
      ]),
    ),
  };
}
export async function getAdminJob(id: string): Promise<AdminJob | null> {
  return (await readAdminJobs(await currentStaffIdentity(), id))[0] ?? null;
}
