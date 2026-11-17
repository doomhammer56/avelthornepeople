import type { AdminLang } from "./nav";
import type { JobStatus } from "./jobStatus";
import { referenceLabel, type ReferenceItem } from "./referenceData";
import type { JobDraft } from "../../server/jobs/management-contract.ts";

type Bilingual = { en: string; zh: string };

// Department/location/type/experience are ids into the managed reference
// lists (Settings screen) rather than fixed union types, so adding a new
// department no longer needs a code change — see referenceData.ts.
export type AdminJob = {
  id: string;
  slug: string;
  title: Bilingual;
  responsibilities: { en: string[]; zh: string[] };
  requirements: { en: string[]; zh: string[] };
  department: string;
  location: string;
  locationIds?: string[];
  type: string;
  experience: string;
  salary: string;
  showSalary: boolean;
  status: JobStatus;
  postedAt: string;
  closesAt: string;
  applications: number | null;
  live?: boolean;
  closeAt?: string | null;
  version: number;
  settingsLocked: boolean;
  draft: JobDraft;
  hasUnpublishedChanges: boolean;
  approvedChineseFallback?: boolean;
};

// List screens/cache entries never need complete job drafts, salaries or descriptions.
export type AdminJobSummary = Pick<
  AdminJob,
  | "id"
  | "title"
  | "department"
  | "location"
  | "locationIds"
  | "type"
  | "status"
  | "live"
  | "closeAt"
  | "closesAt"
  | "applications"
  | "hasUnpublishedChanges"
  | "version"
>;
export type AdminJobPage = {
  jobs: AdminJobSummary[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<JobStatus, number>;
};

export function jobLabel(
  job: Pick<AdminJob, "department" | "location" | "type" | "locationIds">,
  settings: {
    departments: ReferenceItem[];
    locations: ReferenceItem[];
    jobTypes: ReferenceItem[];
  },
  lang: AdminLang,
) {
  return {
    department: referenceLabel(settings.departments, job.department, lang),
    location: (job.locationIds ?? [job.location])
      .map((id) => referenceLabel(settings.locations, id, lang))
      .join(", "),
    type: referenceLabel(settings.jobTypes, job.type, lang),
  };
}

/** English content is optional until HR fills the English tab (A08). */
export function hasEnglish(job: Pick<AdminJob, "title">): boolean {
  return job.title.en.trim().length > 0;
}

export function isPastDeadline(
  job: Pick<AdminJob, "closesAt" | "closeAt">,
  now = new Date(),
): boolean {
  if (job.closeAt !== undefined)
    return !!job.closeAt && new Date(job.closeAt) <= now;
  return !!job.closesAt && job.closesAt < now.toISOString().slice(0, 10);
}

export function blankDraftJob(nextId: string): AdminJob {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: nextId,
    slug: "",
    title: { en: "", zh: "" },
    responsibilities: { en: [], zh: [] },
    requirements: { en: [], zh: [] },
    department: "",
    location: "",
    type: "FULL_TIME",
    experience: "ANY",
    salary: "",
    showSalary: false,
    status: "draft",
    postedAt: today,
    closesAt: "",
    applications: 0,
    version: 1,
    settingsLocked: false,
    hasUnpublishedChanges: false,
    draft: {
      en: { title: "", responsibilities: [], requirements: [] },
      zh: { title: "", responsibilities: [], requirements: [] },
      settings: {
        departmentId: null,
        locationIds: [],
        jobType: "FULL_TIME",
        experience: "ANY",
        salary: null,
        showSalary: false,
        publishAt: null,
        closeAt: null,
      },
    },
  };
}
