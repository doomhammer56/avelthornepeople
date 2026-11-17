import { z } from "zod";
import { parsePublicJobs, type PublicJobSummary } from "./publicJobSchema.ts";
import {
  emptyJobFilters,
  filterPublicJobs,
  type JobFacet,
} from "./publicJobs.ts";

export const jobFacetFields = [
  "department",
  "location",
  "type",
  "experience",
] as const;
export const publicJobPageSize = 10;
export const publicFacetPageSize = 100;
const pageNumber = (value: string | null) =>
  value && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : 1;
export function publicJobQuery(params = new URLSearchParams()) {
  const text = (key: string) => (params.get(key) ?? "").slice(0, 200);
  const size = Number(params.get("pageSize") ?? publicJobPageSize);
  return {
    filters: {
      query: text("q"),
      department: text("department"),
      location: text("location"),
      type: text("type"),
      experience: text("experience"),
    },
    page: pageNumber(params.get("page")),
    pageSize:
      Number.isSafeInteger(size) && size >= 1 && size <= 100
        ? size
        : publicJobPageSize,
    includeFacets: params.get("facets") === "1",
    facetPages: Object.fromEntries(
      jobFacetFields.map((field) => [
        field,
        pageNumber(params.get(`${field}Page`)),
      ]),
    ) as Record<JobFacet, number>,
  };
}
export type PublicJobQuery = ReturnType<typeof publicJobQuery>;
const option = z.object({ en: z.string().min(1), zh: z.string().min(1) });
const facet = z.object({
  options: z.array(option).max(publicFacetPageSize),
  page: z.number().int().positive(),
  totalPages: z.number().int().positive(),
});
export type PublicJobFacets = Record<JobFacet, z.infer<typeof facet>>;
export type PublicJobPage = {
  jobs: PublicJobSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: PublicJobFacets | null;
};
export function parsePublicJobPage(
  payload: unknown,
  query: PublicJobQuery,
): PublicJobPage {
  const page = z
    .object({
      jobs: z.array(z.unknown()).max(query.pageSize),
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      pageSize: z.literal(query.pageSize),
      totalPages: z.number().int().positive(),
      facets: z
        .object({
          department: facet,
          location: facet,
          type: facet,
          experience: facet,
        })
        .nullable(),
    })
    .parse(payload);
  if (
    page.totalPages !== Math.max(1, Math.ceil(page.total / page.pageSize)) ||
    page.page !== Math.min(query.page, page.totalPages) ||
    page.jobs.length !==
      Math.min(
        page.pageSize,
        Math.max(0, page.total - (page.page - 1) * page.pageSize),
      ) ||
    query.includeFacets !== !!page.facets
  )
    throw new Error("Invalid public job page");
  for (const field of jobFacetFields) {
    const f = page.facets?.[field];
    if (f && f.page !== Math.min(query.facetPages[field], f.totalPages))
      throw new Error("Invalid public facet page");
  }
  return { ...page, jobs: parsePublicJobs({ jobs: page.jobs }) };
}
export function previewPublicJobPage(
  jobs: readonly PublicJobSummary[],
  query: PublicJobQuery,
): PublicJobPage {
  const ordered = [...jobs].sort(
    (a, b) => b.postedAt.localeCompare(a.postedAt) || a.id.localeCompare(b.id),
  );
  const filtered = filterPublicJobs(ordered, query.filters);
  const totalPages = Math.max(1, Math.ceil(filtered.length / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const facets = query.includeFacets
    ? (Object.fromEntries(
        jobFacetFields.map((field) => {
          const options = [
            ...new Map(
              ordered.flatMap((job) =>
                job[field] ? [[job[field].en, job[field]] as const] : [],
              ),
            ).values(),
          ].sort((a, b) => a.en.localeCompare(b.en));
          const totalPages = Math.max(
            1,
            Math.ceil(options.length / publicFacetPageSize),
          );
          const page = Math.min(query.facetPages[field], totalPages);
          return [
            field,
            {
              options: options.slice(
                (page - 1) * publicFacetPageSize,
                page * publicFacetPageSize,
              ),
              page,
              totalPages,
            },
          ];
        }),
      ) as PublicJobFacets)
    : null;
  return {
    jobs: filtered.slice((page - 1) * query.pageSize, page * query.pageSize),
    total: filtered.length,
    page,
    totalPages,
    pageSize: query.pageSize,
    facets,
  };
}
export function emptyPublicJobPage(query: PublicJobQuery): PublicJobPage {
  return previewPublicJobPage([], { ...query, filters: emptyJobFilters });
}
