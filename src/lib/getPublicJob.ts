import "server-only";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { jobDetails } from "./jobDetails";
import { isPublicJobOpen } from "./jobNavigation";
import { parsePublicJob, type PublicJobDetail } from "./publicJobSchema";
import { publicJobsSource } from "./publicJobsSource";
import { findPublishedJob } from "../server/jobs/public";

const publicJobCache = { revalidate: 30, tags: ["public-jobs"] };

const cachedPublishedJob = unstable_cache(
  async (slug: string) => findPublishedJob(slug),
  ["public-job-v1"],
  publicJobCache,
);

type PublicJobResult =
  | { status: "ready"; source: "preview" | "api"; job: PublicJobDetail }
  | { status: "missing"; source: "preview" | "api" }
  | { status: "closed"; source: "preview" | "api"; job: PublicJobDetail | null }
  | { status: "unavailable"; source: "preview" | "api" };

// Share one snapshot between page content and metadata in the same request.
// The database and API copies are also cached for 30 seconds and tagged public-jobs.
export const getPublicJob = cache(
  async (slug: string): Promise<PublicJobResult> => {
    const source = publicJobsSource();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      return {
        status: "missing",
        source: source === "preview" ? "preview" : "api",
      };
    if (source === "preview") {
      const job = jobDetails.find((item) => item.slug === slug);
      if (!job) return { status: "missing", source };
      return { status: isPublicJobOpen(job) ? "ready" : "closed", source, job };
    }
    if (source === "database") {
      try {
        const job = await cachedPublishedJob(slug);
        return job
          ? { status: "ready", source: "api", job }
          : { status: "missing", source: "api" };
      } catch {
        return { status: "unavailable", source: "api" };
      }
    }
    if (source !== "api") return { status: "unavailable", source: "api" };

    // Fetch a published role through the backend-owned public detail endpoint.
    // Closed and expired records lose Apply; unknown records remain distinct from closures.
    try {
      const base = new URL(process.env.PUBLIC_API_BASE_URL ?? "");
      if (
        !["http:", "https:"].includes(base.protocol) ||
        base.username ||
        base.password
      )
        throw new Error("Invalid public API configuration");
      const response = await fetch(
        new URL(`/api/jobs/${encodeURIComponent(slug)}`, base),
        {
          next: publicJobCache,
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (response.status === 410)
        return { status: "closed", source: "api", job: null };
      if (response.status === 404) return { status: "missing", source: "api" };
      if (!response.ok) throw new Error("Public job unavailable");
      const job = parsePublicJob(await response.json());
      if (job.slug !== slug) throw new Error("Public job does not match route");
      return isPublicJobOpen(job)
        ? { status: "ready", source: "api", job }
        : { status: "closed", source: "api", job };
    } catch {
      // Keep service failures distinct from missing jobs without exposing upstream records.
      // Visitors can retry safely and no internal response content is logged or rendered.
      return { status: "unavailable", source: "api" };
    }
  },
);
