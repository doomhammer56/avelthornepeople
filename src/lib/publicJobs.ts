import type { Locale } from "./homeContent";
import type { PublicJobSummary } from "./publicJobSchema";

export type { PublicJobSummary } from "./publicJobSchema";
export type JobFilters = {
  query: string;
  department: string;
  location: string;
  type: string;
  experience: string;
};
export type JobFacet = "department" | "location" | "type" | "experience";
export const emptyJobFilters: JobFilters = {
  query: "",
  department: "",
  location: "",
  type: "",
  experience: "",
};

// Search both title translations and combine selected facets with AND semantics.
// Canonical English facet values keep selection independent of displayed labels.
export function filterPublicJobs(
  jobs: readonly PublicJobSummary[],
  filters: JobFilters,
): PublicJobSummary[] {
  const query = filters.query.trim().normalize("NFKC").toLowerCase();
  return jobs.filter(
    (job) =>
      (!query ||
        `${job.title.en} ${job.title.zh}`
          .normalize("NFKC")
          .toLowerCase()
          .includes(query)) &&
      (!filters.department || job.department.en === filters.department) &&
      (!filters.location || job.location.en === filters.location) &&
      (!filters.type || job.type.en === filters.type) &&
      (!filters.experience || job.experience?.en === filters.experience),
  );
}

// Derive available facets from the complete collection rather than filtered results.
// Future teams and locations appear automatically without changing UI constants.
export function getJobOptions(
  jobs: readonly PublicJobSummary[],
  field: JobFacet,
  locale: Locale,
) {
  return Array.from(
    new Map(
      jobs.flatMap((job) => {
        const value = job[field];
        return value
          ? [[value.en, { value: value.en, label: value[locale] }] as const]
          : [];
      }),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label, locale));
}

// Bound the requested page and slice only after all filters have been applied.
// Live removals and malformed URLs cannot leave visitors on a blank out-of-range page.
export function paginatePublicJobs(
  jobs: readonly PublicJobSummary[],
  requested: string | null,
) {
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(jobs.length / pageSize));
  const parsed =
    requested && /^[1-9]\d{0,5}$/.test(requested) ? Number(requested) : 1;
  const page = Math.min(parsed, totalPages);
  return {
    page,
    totalPages,
    jobs: jobs.slice((page - 1) * pageSize, page * pageSize),
  };
}
