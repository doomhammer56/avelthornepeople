import type { AdminJob, AdminJobSummary } from "../../lib/admin/jobFields.ts";
import type { AdminApplication } from "../../lib/admin/adminApplications.ts";
import { safeCount } from "../dashboard/contract.ts";
import type { JobDraft } from "../jobs/management-contract.ts";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const iso = (value: unknown) =>
  value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
const lines = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
export function contentFields(value: unknown) {
  const content = object(value),
    en = object(content.en),
    zh = object(content.zh);
  return {
    title: { en: text(en.title), zh: text(zh.title) },
    responsibilities: {
      en: lines(en.responsibilities),
      zh: lines(zh.responsibilities),
    },
    requirements: { en: lines(en.requirements), zh: lines(zh.requirements) },
    body: { en: text(en.body), zh: text(zh.body) },
  };
}
export function adminJobDto(row: Record<string, unknown>): AdminJob {
  const fields = contentFields(row.draft_content);
  const status = {
    DRAFT: "draft",
    PENDING_REVIEW: "pending",
    PUBLISHED: "published",
    PAUSED: "paused",
    CLOSED: "closed",
  } as const;
  const dbStatus = row.status as keyof typeof status;
  if (!status[dbStatus]) throw new Error("Invalid job status");
  const locations = Array.isArray(row.location_ids)
    ? row.location_ids.map(String)
    : [];
  const rawDraft = object(row.draft_content);
  const liveSettings: JobDraft["settings"] = {
    departmentId: row.department_id ? String(row.department_id) : null,
    locationIds: locations,
    jobType: (text(row.job_type) ||
      "FULL_TIME") as JobDraft["settings"]["jobType"],
    experience: (text(row.experience) ||
      "ANY") as JobDraft["settings"]["experience"],
    salary:
      row.salary_min == null || row.salary_max == null
        ? null
        : {
            min: Number(row.salary_min),
            max: Number(row.salary_max),
            currency: text(row.salary_currency),
            period: text(row.salary_period) as "MONTH",
          },
    showSalary: row.show_salary === true,
    publishAt: row.publish_at ? iso(row.publish_at) : null,
    closeAt: row.close_at ? iso(row.close_at) : null,
  };
  const storedSettings = rawDraft.settings
    ? (rawDraft.settings as JobDraft["settings"])
    : liveSettings;
  const settings = {
    ...storedSettings,
    publishAt: storedSettings.publishAt ? iso(storedSettings.publishAt) : null,
    closeAt: storedSettings.closeAt ? iso(storedSettings.closeAt) : null,
  };
  const draft: JobDraft = {
    en: {
      title: fields.title.en,
      responsibilities: fields.responsibilities.en,
      requirements: fields.requirements.en,
    },
    zh: {
      title: fields.title.zh,
      responsibilities: fields.responsibilities.zh,
      requirements: fields.requirements.zh,
    },
    settings,
    // Carry staff-only details through, otherwise saving in the editor would erase them.
    ...(rawDraft.recruiting &&
    typeof rawDraft.recruiting === "object" &&
    !Array.isArray(rawDraft.recruiting)
      ? { recruiting: rawDraft.recruiting as JobDraft["recruiting"] }
      : {}),
  };
  const published = object(row.published_content);
  const publishedFields = contentFields(published);
  const canonical = (value: unknown): string =>
    JSON.stringify(value, (key, item) =>
      (key === "publishAt" || key === "closeAt") && typeof item === "string"
        ? iso(item)
        : item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(
              Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
            )
          : item,
    );
  const hasUnpublishedChanges =
    !!row.published_content &&
    (canonical(fields) !== canonical(publishedFields) ||
      canonical(settings) !== canonical(published.settings ?? liveSettings));
  return {
    id: String(row.id),
    slug: text(row.canonical_slug),
    title: fields.title,
    responsibilities: fields.responsibilities,
    requirements: fields.requirements,
    department: settings.departmentId ?? "",
    location: settings.locationIds[0] ?? "",
    locationIds: settings.locationIds,
    type: settings.jobType,
    experience: settings.experience,
    salary:
      row.salary_min == null || row.salary_max == null
        ? ""
        : `${row.salary_currency} ${row.salary_min}–${row.salary_max} / ${row.salary_period}`,
    showSalary: settings.showSalary,
    status: status[dbStatus],
    postedAt: iso(row.publish_at ?? row.created_at).slice(0, 10),
    closesAt: row.close_at ? iso(row.close_at).slice(0, 10) : "",
    closeAt: row.close_at ? iso(row.close_at) : null,
    live: row.live === true,
    applications:
      row.applications == null ? null : safeCount(String(row.applications)),
    version: Number(row.version ?? 1),
    settingsLocked: row.settings_locked === true,
    draft,
    hasUnpublishedChanges,
    approvedChineseFallback: published.englishFallback === true,
  };
}
export function adminJobSummaryDto(
  row: Record<string, unknown>,
): AdminJobSummary {
  // Reuse the existing canonical comparison, including reverted changes and legacy settings.
  const job = adminJobDto(row);
  return {
    id: job.id,
    title: job.title,
    department: job.department,
    location: job.location,
    locationIds: job.locationIds,
    type: job.type,
    status: job.status,
    live: job.live,
    closeAt: job.closeAt,
    closesAt: job.closesAt,
    applications: job.applications,
    hasUnpublishedChanges: job.hasUnpublishedChanges,
    version: job.version,
  };
}

export function adminApplicationDto(
  row: Record<string, unknown>,
): AdminApplication {
  const statuses = {
    NEW: "New",
    SCREENING: "Screening",
    INTERVIEW: "Interview",
    OFFER: "Offer",
    REJECTED: "Rejected",
  } as const;
  const status = statuses[row.status as keyof typeof statuses];
  if (!status) throw new Error("Invalid application status");
  const source = String(row.source).toLowerCase();
  return {
    id: String(row.id),
    candidateId: text(row.candidate_id),
    jobId: String(row.job_id),
    // Only the authorized recruitment service fills contact fields through
    // the candidate decryptor; this shared metadata projection omits them.
    name: "",
    email: "",
    phone: "",
    profileAvailable: false,
    source: ["site", "careers", "website"].includes(source)
      ? "site"
      : ["linkedin", "jobstreet", "referral"].includes(source)
        ? (source as "linkedin" | "jobstreet" | "referral")
        : "other",
    status,
    submittedAt: iso(row.submitted_at),
    duplicate: row.duplicate_candidate_match === true,
    cvAvailable: row.cv_available === true,
    consentAt: iso(row.consent_at),
    policyVersion: text(row.policy_version),
    // The language the candidate applied in, stored at intake. Used to send
    // stage-change notifications (reject, interview invite) in that language.
    locale: row.locale === "zh" ? "zh" : "en",
  };
}
