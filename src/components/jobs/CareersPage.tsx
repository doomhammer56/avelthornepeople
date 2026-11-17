"use client";

import { Search } from "lucide-react";
import { PublicIntentLink as Link } from "../PublicIntentLink";
import { useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CareersContent } from "@/lib/careersContent";
import type { HomeContent, Locale } from "@/lib/homeContent";
import { displayHeadingClass } from "@/lib/displayTypography";
import { getJobListingQuery } from "@/lib/jobNavigation";
import {
  emptyJobFilters,
  type JobFacet,
  type JobFilters,
  type PublicJobSummary,
} from "@/lib/publicJobs";
import type { PublicJobFacets } from "@/lib/publicJobQuery";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiteFooter } from "../SiteFooter";
import { SiteHeader } from "../SiteHeader";
import { SiteMotion } from "../SiteMotion";
import { PublicJobsRefresh } from "./PublicJobsRefresh";
import { cn } from "cn";
import {
  careersResultsClass,
  jobClearClass,
  jobDeadlineClass,
  jobDeadlineLabelClass,
  jobDeadlineMutedClass,
  jobDescriptionClass,
  jobMetaClass,
  jobPaginationClass,
  jobResultBarClass,
  jobRowActionClass,
  jobRowClass,
  jobTitleClass,
  jobsEmptyClass,
  jobsPreviewNoteClass,
  publicSiteClass,
  siteButtonClass,
  siteContainerClass,
  skipLinkClass,
} from "@/lib/publicSite";

const CAREERS_FILTER_ALL = "__careers_all__" as const;
const CAREERS_LOCATION_OPTIONS = [
  { value: "Taiwan", en: "Taiwan", zh: "台湾" },
  { value: "Philippines", en: "Philippines", zh: "菲律宾" },
  { value: "Europe", en: "Europe", zh: "欧洲" },
] as const;

function formatListingDeadline(isoDate: string, locale: Locale): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (locale === "zh") {
    return d.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type Props = {
  locale: Locale;
  content: CareersContent;
  siteContent: HomeContent;
  jobs: readonly PublicJobSummary[];
  total: number;
  page: number;
  totalPages: number;
  facets: PublicJobFacets | null;
  source: "preview" | "api";
  failed: boolean;
};

// Read only the known filter fields from the current URL.
// Back/forward navigation restores selections without persisting visitor searches elsewhere.
function readFilters(params: Pick<URLSearchParams, "get">): JobFilters {
  return {
    query: (params.get("q") ?? "").slice(0, 200),
    department: (params.get("department") ?? "").slice(0, 200),
    location: (params.get("location") ?? "").slice(0, 200),
    type: (params.get("type") ?? "").slice(0, 200),
    experience: (params.get("experience") ?? "").slice(0, 200),
  };
}

// The server filters and paginates public summaries; the native GET form also
// works before hydration. Client navigation requests the same bounded data.
export function CareersPage({
  locale,
  content: t,
  siteContent,
  jobs,
  total,
  page,
  totalPages,
  facets: facetData,
  source,
  failed,
}: Props) {
  const searchParams = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  // Carry the current listing context once for every role's return link.
  // Encoding only whitelisted filters keeps detail URLs safe and avoids per-row parsing.
  const detailQuery = useMemo(() => {
    const listing = getJobListingQuery(searchParams);
    return listing ? `?${new URLSearchParams({ listing })}` : "";
  }, [searchParams]);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const hasFilters = Object.values(filters).some(Boolean);
  const pagination = { jobs, page, totalPages };
  // Build native page links from the same whitelisted context used by job return links.
  // Pagination remains shareable and functional without JavaScript.
  const pageHref = (page: number) => {
    const params = new URLSearchParams(getJobListingQuery(searchParams));
    if (page > 1) params.set("page", String(page));
    else params.delete("page");
    return `/${locale}/careers${params.size ? `?${params}` : ""}`;
  };
  const facets = useMemo(
    () => [
      {
        field: "department" as const,
        label: t.department,
        all: t.allDepartments,
        options:
          facetData?.department.options.map((o) => ({
            value: o.en,
            label: o[locale],
          })) ?? [],
      },
      {
        field: "location" as const,
        label: t.location,
        all: t.allLocations,
        options: CAREERS_LOCATION_OPTIONS.map((option) => ({
          value: option.value,
          label: option[locale],
        })),
      },
      {
        field: "type" as const,
        label: t.type,
        all: t.allTypes,
        options:
          facetData?.type.options.map((o) => ({
            value: o.en,
            label: o[locale],
          })) ?? [],
      },
      {
        field: "experience" as const,
        label: t.experience,
        all: t.allExperience,
        options:
          facetData?.experience.options.map((o) => ({
            value: o.en,
            label: o[locale],
          })) ?? [],
      },
    ],
    [facetData, locale, t],
  );

  // Submit search text together with the current native select values. One
  // navigation per submission keeps rapid control changes from overwriting them.
  const updateFilters = (next: JobFilters) => {
    const url = new URL(window.location.href);
    const values = {
      q: next.query,
      department: next.department,
      location: next.location,
      type: next.type,
      experience: next.experience,
    };
    Object.entries(values).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    });
    url.searchParams.delete("page");
    startTransition(() =>
      router.push(`${url.pathname}${url.search}${url.hash}`, { scroll: false }),
    );
  };

  const facetHref = (field: JobFacet, page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(`${field}Page`, String(page));
    return `/${locale}/careers?${params}`;
  };
  const hasMultipleFacetPages = (field: JobFacet) =>
    field !== "location" && (facetData?.[field].totalPages ?? 1) > 1;

  // Preserve a selected facet if a live update removes its last matching job.
  // The location filter is a fixed allowlist and never adds a dynamic fallback option.
  const optionsFor = (
    field: JobFacet,
    options: { value: string; label: string }[],
  ) =>
    field !== "location" &&
    filters[field] &&
    !options.some((option) => option.value === filters[field])
      ? [...options, { value: filters[field], label: filters[field] }]
      : options;

  return (
    <div className={publicSiteClass} data-public-site>
      <a className={skipLinkClass} href="#main-content">
        {locale === "en" ? "Skip to content" : "跳至主要内容"}
      </a>
      <SiteHeader
        locale={locale}
        content={siteContent}
        activePage="careers"
        languageQuery={getJobListingQuery(searchParams)}
      />
      <main id="main-content">
        <section
          className="bg-site-header-light"
          aria-labelledby="careers-heading"
        >
          <div className={`${siteContainerClass} flex flex-col items-center gap-3 pt-10 pb-10 text-center sm:gap-4 sm:pt-12 sm:pb-12 lg:pt-16 lg:pb-14`}>
            <h1
              id="careers-heading"
              className={cn(displayHeadingClass, "m-0 max-w-3xl")}
            >
              {t.title}
            </h1>
            <p className="m-0 max-w-xl text-sm sm:text-base text-muted-foreground leading-relaxed">
              {t.description}
            </p>

            <form
              className="mx-auto mt-4 sm:mt-6 flex w-full flex-col gap-5 sm:gap-6 text-left"
              action={`/${locale}/careers`}
              method="get"
              role="search"
              aria-label={t.title}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                updateFilters({
                  query: String(data.get("q") ?? ""),
                  department: filters.department,
                  location: filters.location,
                  type: filters.type,
                  experience: filters.experience,
                });
              }}
            >
              <div className="relative mx-auto w-full max-w-3xl">
                <Label className="m-0 block w-full">
                  <span className="sr-only">{t.search}</span>
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 z-[1] size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    name="q"
                    placeholder={t.search}
                    key={filters.query}
                    defaultValue={filters.query}
                    maxLength={200}
                    className="relative h-14 rounded-xl border-foreground/15 bg-white pl-11 pr-[7.25rem] text-base shadow-none sm:text-sm"
                  />
                </Label>
                <Button
                  type="submit"
                  size="sm"
                  className="absolute top-1/2 right-2 z-[1] h-10 -translate-y-1/2 rounded-lg px-5"
                >
                  {t.searchAction}
                </Button>
              </div>

              <div className="mx-auto grid w-full max-w-none grid-cols-2 gap-x-3 gap-y-4 px-0 sm:gap-4 lg:max-w-6xl lg:grid-cols-4 xl:max-w-7xl lg:justify-items-stretch lg:gap-5">
                {facets.map(({ field, label, all, options }) => (
                  <div
                    className="flex min-w-0 flex-col gap-1.5 sm:gap-2 lg:min-w-[10.5rem]"
                    key={field}
                  >
                    <Label className="text-xs font-medium text-foreground/80 sm:text-[13px]">
                      {label}
                    </Label>
                    {(() => {
                      const facetOptions = optionsFor(field, options);
                      const selectOptions = [
                        { value: CAREERS_FILTER_ALL, label: all },
                        ...facetOptions.map((o) => ({
                          value: o.value,
                          label: o.label,
                        })),
                      ];
                      const current =
                        filters[field] || CAREERS_FILTER_ALL;
                      return (
                        <Select
                          value={current}
                          onValueChange={(next) => {
                            if (!next) return;
                            updateFilters({
                              ...filters,
                              [field]:
                                next === CAREERS_FILTER_ALL ? "" : next,
                            });
                          }}
                        >
                          <SelectTrigger
                            size="default"
                            className={cn(
                              "flex w-full min-w-0 items-center justify-between rounded-md border border-foreground/20 bg-white pl-3.5 pr-3 text-sm font-normal text-muted-foreground shadow-none sm:text-[15px]",
                              "h-12 min-h-12 py-0 data-[size=default]:h-12 data-[size=default]:min-h-12",
                              // Let labels use the wider grid; avoid single-line clamp/truncate from the base trigger.
                              "[&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:text-muted-foreground *:data-[slot=select-value]:line-clamp-none *:data-[slot=select-value]:whitespace-normal *:data-[slot=select-value]:break-words",
                              "[&_svg]:shrink-0 [&_svg]:text-muted-foreground/80",
                              "focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20",
                            )}
                            aria-label={label}
                          >
                            <SelectValue>
                              {selectOptions.find((o) => o.value === current)
                                ?.label ??
                                (field === "location" ? current : all)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent
                            align="start"
                            alignItemWithTrigger={false}
                            className={cn(
                              // Widen for long labels; align popup to trigger (not option text ↔ trigger value).
                              "min-w-[var(--anchor-width)] w-max max-w-[min(92vw,24rem)] text-sm sm:text-[15px] text-muted-foreground",
                              "data-[side=bottom]:slide-in-from-top-1",
                            )}
                          >
                            {selectOptions.map((option) => (
                              <SelectItem
                                key={`${field}-${option.value}`}
                                value={option.value}
                                className={cn(
                                  "py-2.5 text-sm sm:text-[15px]",
                                  "focus:text-foreground data-[highlighted]:text-foreground",
                                )}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}
                    {hasMultipleFacetPages(field) && (
                      <span className="text-xs text-muted-foreground">
                        {facetData![field].page > 1 && (
                          <Link
                            prefetch={false}
                            href={facetHref(field, facetData![field].page - 1)}
                          >
                            {t.previous}
                          </Link>
                        )}
                        {` ${t.page} ${facetData![field].page} ${t.of} ${facetData![field].totalPages} `}
                        {facetData![field].page <
                          facetData![field].totalPages && (
                          <Link
                            prefetch={false}
                            href={facetHref(field, facetData![field].page + 1)}
                          >
                            {t.next}
                          </Link>
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </form>
          </div>
        </section>
        <section
          className={`${siteContainerClass} ${careersResultsClass}`}
          aria-label={siteContent.all_jobs}
        >
          {source === "preview" && (
            <p className={jobsPreviewNoteClass}>{t.preview}</p>
          )}
          {/* Report service failure separately from an empty or filtered collection.
              A retry refreshes server data without substituting sample vacancies. */}
          {failed ? (
            <div className={jobsEmptyClass} role="alert">
              <h2>{t.unavailable}</h2>
              <p>{t.unavailableDescription}</p>
              <button
                type="button"
                className={siteButtonClass({ outline: true, waiting: true })}
                disabled={pending}
                onClick={() => startTransition(() => router.refresh())}
              >
                {pending ? t.loading : t.retry}
              </button>
            </div>
          ) : (
            <>
              <div className={jobResultBarClass}>
                <p role="status" aria-live="polite" aria-atomic="true">
                  {locale === "zh"
                    ? `${total} 个职位`
                    : `${total} ${total === 1 ? "job" : "jobs"}`}
                </p>
                {hasFilters && (
                  <button
                    type="button"
                    className={jobClearClass}
                    onClick={() => updateFilters(emptyJobFilters)}
                  >
                    {t.clear}
                  </button>
                )}
              </div>
              <ul className="m-0 list-none p-0">
                {pagination.jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      className={`group/careers-row ${jobRowClass}`}
                      href={`/${locale}/jobs/${job.slug}${detailQuery}`}
                      prefetch={false}
                    >
                      <div className={jobDescriptionClass}>
                        <h2 className={jobTitleClass}>{job.title[locale]}</h2>
                        {locale === "en" && job.contentLanguage === "zh" ? (
                          <span>English version not available</span>
                        ) : null}
                        {locale === "zh" && job.contentLanguage === "en" ? (
                          <span>暂无中文版本</span>
                        ) : null}
                        <p className={jobMetaClass}>
                          {[
                            job.department[locale],
                            job.location[locale],
                            job.type[locale],
                          ].join(" · ")}
                        </p>
                      </div>
                      <div className={jobRowActionClass}>
                        {job.closesAt ? (
                          <time
                            className={jobDeadlineClass}
                            dateTime={job.closesAt}
                          >
                            <span className={jobDeadlineLabelClass}>
                              {t.expires}
                            </span>{" "}
                            {formatListingDeadline(job.closesAt, locale)}
                          </time>
                        ) : (
                          <span className={jobDeadlineMutedClass}>
                            {locale === "zh" ? "持续招聘" : "Open until filled"}
                          </span>
                        )}
                        <span
                          className={cn(
                            buttonVariants({
                              variant: "outline",
                              size: "sm",
                            }),
                            // Same hover affordance as Button outline; row is group/careers-row.
                            "pointer-events-none min-h-9 shrink-0 px-3.5 text-xs transition-all duration-150",
                            "group-hover/careers-row:bg-foreground/5 group-hover/careers-row:border-foreground/50",
                          )}
                        >
                          {t.apply}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {total > 0 && (
                <nav className={jobPaginationClass} aria-label={t.pagination}>
                  {pagination.page > 1 ? (
                    <Link href={pageHref(pagination.page - 1)} prefetch={false}>
                      {t.previous}
                    </Link>
                  ) : (
                    <span aria-disabled="true">{t.previous}</span>
                  )}
                  <p aria-current="page">
                    {t.page} {pagination.page} {t.of} {pagination.totalPages}
                  </p>
                  {pagination.page < pagination.totalPages ? (
                    <Link href={pageHref(pagination.page + 1)} prefetch={false}>
                      {t.next}
                    </Link>
                  ) : (
                    <span aria-disabled="true">{t.next}</span>
                  )}
                </nav>
              )}
              {total === 0 && (
                <div className={jobsEmptyClass}>
                  <h2>{t.empty}</h2>
                  {hasFilters && (
                    <button
                      type="button"
                      className={siteButtonClass({ outline: true })}
                      onClick={() => updateFilters(emptyJobFilters)}
                    >
                      {t.clear}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </main>
      <SiteFooter locale={locale} content={siteContent} />
      <SiteMotion pageKey={`${locale}/careers`} />
      <PublicJobsRefresh enabled={source === "api"} />
    </div>
  );
}
