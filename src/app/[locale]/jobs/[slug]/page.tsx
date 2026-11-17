import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { JobDetailView } from "@/components/jobs/JobDetailView";
import { JobDetailPage } from "@/components/jobs/JobDetailPage";
import { JobDetailRetry } from "@/components/jobs/JobDetailRetry";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PublicJobsRefresh } from "@/components/jobs/PublicJobsRefresh";
import { getPublicJob } from "@/lib/getPublicJob";
import { getPublicJobs, getPublicJobsForSitemap } from "@/lib/getPublicJobs";
import { ClosedJobPage } from "@/components/jobs/ClosedJobPage";
import { homeContent, type Locale } from "@/lib/homeContent";
import { jobDetailContent } from "@/lib/jobDetailContent";
import { JobDetailPending } from "@/components/jobs/PagePending";
import { getJobListingQuery } from "@/lib/jobNavigation";
import { buildJobPostingJsonLd, serializeJsonLd } from "@/lib/jobPostingSchema";
import { getSiteUrl } from "@/lib/siteUrl";
import {
  jobsEmptyClass,
  publicSiteClass,
  siteContainerClass,
  skipLinkClass,
  textLinkClass,
} from "@/lib/publicSite";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Validate language segments before fetching or rendering vacancy content.
// The slug itself is validated by the shared public-detail loader.
async function getRoute(
  params: Props["params"],
): Promise<{ locale: Locale; slug: string }> {
  const { locale, slug } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return { locale, slug };
}

// Prerender every published vacancy in both languages. Unknown slugs still resolve on demand.
export async function generateStaticParams() {
  try {
    const { jobs, failed } = await getPublicJobsForSitemap();
    if (failed) return [];
    return (["en", "zh"] as const).flatMap((locale) =>
      jobs.map((job) => ({ locale, slug: job.slug })),
    );
  } catch {
    return [];
  }
}

export const dynamicParams = true;

// Keep page titles and language alternates specific to the selected vacancy.
// Only an open, ready vacancy is indexable; closed/unavailable pages stay noindex.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await getRoute(params);
  const data = await getPublicJob(slug);
  if (data.status === "missing") notFound();
  return {
    title: `${data.status === "ready" ? data.job.title[locale] : data.status === "closed" ? jobDetailContent[locale].closed : jobDetailContent[locale].unavailableTitle} | ${homeContent[locale].brand}`,
    description:
      data.status === "ready"
        ? data.job.responsibilities[locale].join(". ").slice(0, 160)
        : data.status === "closed"
          ? jobDetailContent[locale].closedDescription
          : jobDetailContent[locale].unavailableDescription,
    alternates: {
      canonical: `/${locale}/jobs/${slug}`,
      languages: {
        en: `/en/jobs/${slug}`,
        zh: `/zh/jobs/${slug}`,
        "x-default": `/en/jobs/${slug}`,
      },
    },
    robots: { index: data.status === "ready", follow: true },
  };
}

// Navigation paints immediately. The vacancy body streams in when the record is ready.
export default async function Page({ params, searchParams }: Props) {
  const { locale, slug } = await getRoute(params);
  setRequestLocale(locale);
  return (
    <Suspense fallback={<JobDetailPending locale={locale} slug={slug} />}>
      <JobDetailLoaded
        locale={locale}
        slug={slug}
        searchParams={searchParams}
      />
    </Suspense>
  );
}

// Fetch the selected role and whitelist any carried listing filters.
// Missing jobs get a 404; service failures remain retryable without substituting fixtures.
async function JobDetailLoaded({
  locale,
  slug,
  searchParams,
}: {
  locale: "en" | "zh";
  slug: string;
  searchParams: Props["searchParams"];
}) {
  const [data, query] = await Promise.all([getPublicJob(slug), searchParams]);
  if (data.status === "missing") notFound();
  const listingQuery = getJobListingQuery(
    new URLSearchParams(typeof query.listing === "string" ? query.listing : ""),
  );
  const t = jobDetailContent[locale];
  // Fetch related public openings only for a confirmed closure with a known department.
  // A bare 410 still shows a closed notice; a 404 remains an unknown-role response.
  if (data.status === "closed") {
    const related = data.job
      ? await getPublicJobs(
          new URLSearchParams({
            department: data.job.department.en,
            pageSize: "3",
          }),
        )
      : { jobs: [], failed: false };
    return (
      <ClosedJobPage
        locale={locale}
        slug={slug}
        job={data.job}
        jobs={related.jobs}
        failed={related.failed}
        listingQuery={listingQuery}
        live={data.source === "api"}
      />
    );
  }
  // Keep temporary failures retryable instead of treating them as removed vacancies.
  // The same polling mechanism can recover when the public service becomes available.
  if (data.status === "unavailable")
    return (
      <div className={publicSiteClass} data-public-site>
        <a className={skipLinkClass} href="#main-content">
          {locale === "en" ? "Skip to content" : "跳至主要内容"}
        </a>
        <SiteHeader
          locale={locale}
          content={homeContent[locale]}
          activePage="careers"
          localePath={`/jobs/${slug}`}
        />
        <main className={`${siteContainerClass} ${jobsEmptyClass}`} id="main-content">
          <h1>{t.unavailableTitle}</h1>
          <p>{t.unavailableDescription}</p>
          <JobDetailRetry label={t.retry} pendingLabel={t.loading} />
          <Link
            className={textLinkClass}
            href={`/${locale}/careers${listingQuery ? `?${listingQuery}` : ""}`}
          >
            {t.back}
          </Link>
        </main>
        <SiteFooter locale={locale} content={homeContent[locale]} />
        <PublicJobsRefresh enabled />
      </div>
    );
  return (
    <>
      <script
        type="application/ld+json"
        // Google for Jobs reads this tag directly off the rendered HTML.
        // serializeJsonLd escapes "<" so backend copy can never break out of the tag.
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            buildJobPostingJsonLd(data.job, locale, getSiteUrl()),
          ),
        }}
      />
      {data.source === "api" && (
        <JobDetailView jobId={data.job.id} locale={locale} />
      )}
      <JobDetailPage
        locale={locale}
        content={t}
        siteContent={homeContent[locale]}
        job={data.job}
        source={data.source}
        listingQuery={listingQuery}
        applicationEndpoints={
          data.source === "api"
            ? {
                upload: "/api/applications/uploads",
                applications: "/api/applications",
              }
            : null
        }
        turnstileSiteKey={process.env.AUTH_TURNSTILE_SITE_KEY ?? ""}
      />
    </>
  );
}
