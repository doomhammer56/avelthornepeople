import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/siteUrl";
import { getPublicJobsForSitemap } from "@/lib/getPublicJobs";

const staticPaths = ["", "/about", "/services", "/careers", "/contact"];

// Pair each locale's URL with its sibling so search engines see them as translations.
// Next's sitemap alternates mirror the hreflang already set in page metadata.
function withAlternates(path: string, siteUrl: URL) {
  return {
    en: new URL(`/en${path}`, siteUrl).toString(),
    zh: new URL(`/zh${path}`, siteUrl).toString(),
    "x-default": new URL(`/en${path}`, siteUrl).toString(),
  };
}

// List every canonical public URL so crawlers discover pages without following links.
// Job entries come from the live source so closed/removed roles drop out automatically.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();
  const staticEntries: MetadataRoute.Sitemap = staticPaths.flatMap((path) =>
    ["en", "zh"].map((locale) => ({
      url: new URL(`/${locale}${path}`, siteUrl).toString(),
      alternates: { languages: withAlternates(path, siteUrl) },
    })),
  );

  const { jobs, failed } = await getPublicJobsForSitemap();
  // Public marketing URLs remain discoverable if the jobs source is unavailable.
  const jobEntries: MetadataRoute.Sitemap = failed
    ? []
    : jobs.flatMap((job) =>
        ["en", "zh"].map((locale) => ({
          url: new URL(`/${locale}/jobs/${job.slug}`, siteUrl).toString(),
          lastModified: new Date(job.postedAt),
          alternates: {
            languages: withAlternates(`/jobs/${job.slug}`, siteUrl),
          },
        })),
      );

  return [...staticEntries, ...jobEntries];
}

export const dynamic = "force-dynamic";
