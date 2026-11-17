import "server-only";
import { homeJobs } from "./homeJobs.ts";
import { publicJobsSource } from "./publicJobsSource.ts";
import {
  publicJobQuery,
  previewPublicJobPage,
  parsePublicJobPage,
  emptyPublicJobPage,
  type PublicJobPage,
} from "./publicJobQuery.ts";
import { publishedJobPage, publishedJobLinks } from "../server/jobs/public.ts";

const publicJobCache = { revalidate: 30, tags: ["public-jobs"] };

// Loaded only for database reads so unit tests can call the API path without Next's loader.
let cachedPublishedJobPage:
  | ((search: string) => Promise<PublicJobPage>)
  | undefined;

async function readPublishedJobPage(search: string) {
  cachedPublishedJobPage ??= (
    await import("next/cache")
  ).unstable_cache(
    async (value: string) =>
      publishedJobPage(publicJobQuery(new URLSearchParams(value))),
    ["public-job-page-v1"],
    publicJobCache,
  );
  return cachedPublishedJobPage(search);
}

export type PublicJobsResult = PublicJobPage & {
  source: "preview" | "api";
  failed: boolean;
};

// Sitemap generation is an export: traverse bounded pages intentionally, never
// mistake the first listing page for the complete set of discoverable URLs.
export async function getPublicJobsForSitemap(): Promise<{
  jobs: { slug: string; postedAt: string }[];
  failed: boolean;
}> {
  if (publicJobsSource() === "preview")
    return {
      jobs: homeJobs.map(({ slug, postedAt }) => ({ slug, postedAt })),
      failed: false,
    };
  if (publicJobsSource() === "database") {
    try {
      return { jobs: await publishedJobLinks(), failed: false };
    } catch {
      return { jobs: [], failed: true };
    }
  }
  const first = await getPublicJobs(new URLSearchParams({ pageSize: "100" }));
  if (first.failed) return first;
  const jobs = [...first.jobs];
  for (let page = 2; page <= first.totalPages; page++) {
    const next = await getPublicJobs(
      new URLSearchParams({ pageSize: "100", page: String(page) }),
    );
    if (next.failed || next.total !== first.total)
      return { ...first, jobs: [], failed: true };
    jobs.push(...next.jobs);
  }
  if (
    new Set(jobs.map((job) => job.id)).size !== first.total ||
    new Set(jobs.map((job) => job.slug)).size !== first.total
  )
    return { ...first, jobs: [], failed: true };
  return {
    jobs: jobs.map(({ slug, postedAt }) => ({ slug, postedAt })),
    failed: false,
  };
}

// Keep public transport configuration on the server and shared by Home and Careers.
// Preview data is explicit; an API failure must never masquerade as open sample vacancies.
export async function getPublicJobs(
  params = new URLSearchParams(),
): Promise<PublicJobsResult> {
  const query = publicJobQuery(params);
  const unavailable = (): PublicJobsResult => ({
    ...emptyPublicJobPage(query),
    source: "api",
    failed: true,
  });
  const source = publicJobsSource();
  if (source === "preview") {
    return {
      ...previewPublicJobPage(homeJobs, query),
      source: "preview",
      failed: false,
    };
  }
  if (source === "database") {
    try {
      return {
        ...(await readPublishedJobPage(params.toString())),
        source: "api",
        failed: false,
      };
    } catch {
      return unavailable();
    }
  }
  if (source !== "api") return unavailable();

  // Cache the upstream response briefly. A failed response throws and is not stored.
  // Tag invalidation still publishes and closes roles inside the one-minute budget.
  try {
    const base = new URL(process.env.PUBLIC_API_BASE_URL ?? "");
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password
    )
      throw new Error("Invalid public API configuration");
    const url = new URL("/api/jobs", base);
    url.search = params.toString();
    const response = await fetch(url, {
      next: publicJobCache,
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Public jobs unavailable");
    const data = parsePublicJobPage(await response.json(), query);
    return {
      ...data,
      source: "api",
      failed: false,
    };
  } catch {
    // Return a safe availability state without logging upstream bodies or records.
    // The UI distinguishes service failure from a genuinely empty published collection.
    return unavailable();
  }
}
