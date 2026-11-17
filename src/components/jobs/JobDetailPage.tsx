import { ArrowLeft } from "lucide-react";
import { PublicIntentLink as Link } from "../PublicIntentLink";
import type { HomeContent, Locale } from "@/lib/homeContent";
import type { JobDetailContent } from "@/lib/jobDetailContent";
import type { PublicJobDetail } from "@/lib/publicJobSchema";
import { SiteHeader } from "../SiteHeader";
import { SiteFooter } from "../SiteFooter";
import { SiteMotion } from "../SiteMotion";
import { PublicJobsRefresh } from "./PublicJobsRefresh";
import { ApplicationDrawer } from "./ApplicationDrawer";
import { applicationContent } from "@/lib/applicationContent";
import type { ApplicationEndpoints } from "@/lib/applicationForm";
import { JobShare } from "./JobShare";
import {
  formatPublicJobCloseDisplay,
  formatPublicJobPostedDate,
} from "@/lib/jobNavigation";
import { PageHeader } from "@/components/ui/page-header";
import { publicSiteClass, siteContainerClass, skipLinkClass } from "@/lib/publicSite";

type Props = {
  locale: Locale;
  content: JobDetailContent;
  siteContent: HomeContent;
  job: PublicJobDetail;
  source: "preview" | "api";
  listingQuery: string;
  applicationEndpoints: ApplicationEndpoints | null;
  /** Public Turnstile site key (passed from server; same value as staff login). */
  turnstileSiteKey?: string;
};

// Render one validated vacancy using the handoff's facts, lists and sticky apply card.
// The page receives public data rather than depending on a database or response shape.
export function JobDetailPage({
  locale,
  content: t,
  siteContent,
  job,
  source,
  listingQuery,
  applicationEndpoints,
  turnstileSiteKey = "",
}: Props) {
  const listingHref = `/${locale}/careers${listingQuery ? `?${listingQuery}` : ""}`;
  const languageQuery = listingQuery
    ? new URLSearchParams({ listing: listingQuery }).toString()
    : "";
  const facts: {
    label: string;
    value: string;
    dateTime?: string;
  }[] = [
    { label: t.department, value: job.department[locale] },
    { label: t.location, value: job.location[locale] },
    { label: t.type, value: job.type[locale] },
    {
      label: t.posted,
      value: formatPublicJobPostedDate(job.postedAt, locale),
      dateTime: job.postedAt,
    },
  ];
  const blocks = [
    {
      id: "responsibilities",
      title: t.responsibilities,
      items: job.responsibilities[locale],
    },
    {
      id: "requirements",
      title: t.requirements,
      items: job.requirements[locale],
    },
  ];
  // Format compensation only after the public adapter has honored its visibility flag.
  // Omitted salary is valid and never replaced with fabricated figures or currency.
  const salary = job.showSalary === true ? job.salary : null;
  const currency = salary
    ? new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en", {
        style: "currency",
        currency: salary.currency,
        maximumFractionDigits: 2,
      })
    : null;

  return (
    <div className={publicSiteClass} data-public-site>
      <a className={skipLinkClass} href="#main-content">
        {locale === "en" ? "Skip to content" : "跳至主要内容"}
      </a>
      <SiteHeader
        locale={locale}
        content={siteContent}
        activePage="careers"
        localePath={`/jobs/${job.slug}`}
        languageQuery={languageQuery}
      />
      <main id="main-content">
        <PageHeader
          variant="plain"
          headingId="job-detail-heading"
          title={job.title[locale]}
          aboveTitle={
            <Link
              className="inline-flex min-h-11 items-center gap-2 self-start text-sm leading-snug text-muted-foreground hover:text-primary"
              href={listingHref}
              prefetch={false}
            >
              <ArrowLeft className="size-4 shrink-0" aria-hidden />
              {t.back}
            </Link>
          }
        >
          {locale === "en" && job.contentLanguage === "zh" ? (
            <p lang="en">
              English version not available. This vacancy is shown in Chinese.
            </p>
          ) : null}
          {locale === "zh" && job.contentLanguage === "en" ? (
            <p lang="zh-CN">暂无中文版本，此职位以英文显示。</p>
          ) : null}
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] leading-normal">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5"
              >
                <dt className="m-0 font-semibold text-[color-mix(in_srgb,var(--foreground)_70%,var(--muted-foreground))]">
                  {fact.label}
                </dt>
                <dd className="m-0 font-medium text-[var(--site-ink-secondary)]">
                  {fact.dateTime ? (
                    <time dateTime={fact.dateTime}>{fact.value}</time>
                  ) : (
                    fact.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {salary && currency && (
            <p className="m-0 flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 text-[15px] leading-normal">
              <span className="font-semibold text-[color-mix(in_srgb,var(--foreground)_70%,var(--muted-foreground))]">
                {t.salary}
              </span>
              <span className="font-medium text-[var(--site-ink-secondary)]">
                {currency.format(salary.min)} – {currency.format(salary.max)} /{" "}
                {salary.period[locale]}
              </span>
            </p>
          )}
          {source === "preview" && (
            <p className="m-0 text-sm leading-normal text-muted-foreground">
              {t.preview}
            </p>
          )}
        </PageHeader>
        <div className={`${siteContainerClass} flex flex-wrap items-start gap-x-16 gap-y-10 pt-[clamp(2.5rem,5vw,4rem)] pb-[clamp(3.5rem,7vw,6rem)]`}>
          {/* Keep all responsibilities and requirements in the rendered document.
            Semantic lists remain readable without JavaScript and never insert raw API HTML. */}
          <div className="flex min-w-0 flex-[999_1_460px] flex-col gap-10">
            {blocks.map((block) => (
              <section
                key={block.id}
                className="flex flex-col gap-4"
                aria-labelledby={`job-${block.id}`}
              >
                <h2
                  id={`job-${block.id}`}
                  className="text-xl font-semibold leading-snug"
                >
                  {block.title}
                </h2>
                <ul className="m-0 list-disc space-y-2.5 pl-6 text-base leading-[1.8] text-[var(--site-ink-secondary)] marker:text-primary [overflow-wrap:anywhere]">
                  {block.items.map((item, index) => (
                    <li key={`${block.id}-${index}`} className="pl-1.5">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {/* Open the application drawer for this role without leaving its description.
            Submission is enabled only after the backend endpoints are explicitly configured. */}
          <aside
            className="sticky top-24 flex min-w-[min(100%,300px)] flex-[1_1_300px] flex-col gap-4 rounded-[4px_28px_4px_4px] border border-border bg-card p-7"
            aria-labelledby="job-apply-heading"
          >
            <h2
              id="job-apply-heading"
              className="text-[17px] font-semibold leading-snug text-foreground"
            >
              {t.applyTitle}
            </h2>
            <p className="m-0 text-sm leading-relaxed text-muted-foreground">
              {t.applyDescription}
            </p>
            <ApplicationDrawer
              key={job.id}
              locale={locale}
              content={applicationContent[locale]}
              jobId={job.id}
              jobTitle={job.title[locale]}
              applyLabel={t.apply}
              endpoints={applicationEndpoints}
              turnstileSiteKey={turnstileSiteKey}
            />
            <JobShare title={job.title[locale]} content={t} />
            {job.closesAt && (
              <p className="m-0 text-[13px] leading-normal text-muted-foreground">
                {t.closes}{" "}
                <time
                  className="font-medium text-foreground"
                  dateTime={job.closesAt}
                >
                  {formatPublicJobCloseDisplay(job.closesAt, locale)}
                </time>
              </p>
            )}
          </aside>
        </div>
      </main>
      <SiteFooter locale={locale} content={siteContent} />
      <SiteMotion pageKey={`${locale}/jobs/${job.slug}`} />
      <PublicJobsRefresh enabled={source === "api"} />
    </div>
  );
}
