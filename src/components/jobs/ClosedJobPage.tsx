import { ArrowLeft } from "lucide-react";
import { PublicIntentLink as Link } from "../PublicIntentLink";
import type { Locale } from "@/lib/homeContent";
import { homeContent } from "@/lib/homeContent";
import { jobDetailContent } from "@/lib/jobDetailContent";
import type { PublicJobDetail, PublicJobSummary } from "@/lib/publicJobSchema";
import { SiteHeader } from "../SiteHeader";
import { SiteFooter } from "../SiteFooter";
import { PublicJobsRefresh } from "./PublicJobsRefresh";
import {
  closedJobClass,
  closedJobTitleClass,
  publicSiteClass,
  relatedJobDescriptionClass,
  relatedJobRowClass,
  siteContainerClass,
  skipLinkClass,
} from "@/lib/publicSite";

// Keep confirmed closures distinct from unknown URLs and never expose an Apply action.
// Suggestions use only current public summaries from the same department when that identity is known.
export function ClosedJobPage({
  locale,
  slug,
  job,
  jobs,
  failed,
  listingQuery,
  live,
}: {
  locale: Locale;
  slug: string;
  job: PublicJobDetail | null;
  jobs: readonly PublicJobSummary[];
  failed: boolean;
  listingQuery: string;
  live: boolean;
}) {
  const t = jobDetailContent[locale];
  const related = job
    ? jobs
        .filter(
          (item) =>
            item.id !== job.id && item.department.en === job.department.en,
        )
        .slice(0, 3)
    : [];
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
        languageQuery={
          listingQuery
            ? new URLSearchParams({ listing: listingQuery }).toString()
            : ""
        }
      />
      <main id="main-content" className={`${siteContainerClass} ${closedJobClass}`}>
        <Link
          className="inline-flex min-h-11 items-center gap-2 self-start text-sm leading-snug text-muted-foreground hover:text-primary"
          href={`/${locale}/careers${listingQuery ? `?${listingQuery}` : ""}`}
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden />
          {t.back}
        </Link>
        <h1>{t.closed}</h1>
        {job && <p className={closedJobTitleClass}>{job.title[locale]}</p>}
        <p>{t.closedDescription}</p>
        {job && (
          <section aria-labelledby="related-jobs-heading">
            <h2 id="related-jobs-heading">{t.related}</h2>
            {failed ? (
              <p role="status">{t.relatedUnavailable}</p>
            ) : related.length ? (
              <ul className="m-0 list-none p-0">
                {related.map((item) => (
                  <li key={item.id}>
                    <Link
                      className={relatedJobRowClass}
                      href={`/${locale}/jobs/${item.slug}`}
                      prefetch={false}
                    >
                      <span className={relatedJobDescriptionClass}>
                        <strong>{item.title[locale]}</strong>
                        <span>
                          {item.location[locale]} · {item.type[locale]}
                        </span>
                      </span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t.noRelated}</p>
            )}
          </section>
        )}
      </main>
      <SiteFooter locale={locale} content={homeContent[locale]} />
      <PublicJobsRefresh enabled={live} />
    </div>
  );
}
