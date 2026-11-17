import { ArrowUpRight } from "lucide-react";
import { PublicIntentLink as Link } from "../PublicIntentLink";
import { SectionHeader } from "@/components/ui/section-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { revealClass } from "@/lib/publicSite";
import type { HomeContent, Locale } from "@/lib/homeContent";
import type { PublicJobSummary } from "@/lib/publicJobs";
import { SectionSpinner } from "../SectionSpinner";
import { homeSectionWithRuleClass } from "./siteSection";

function HomeJobCard({
  job,
  locale,
}: {
  job: PublicJobSummary;
  locale: Locale;
}) {
  return (
    <Link
      href={`/${locale}/jobs/${job.slug}`}
      prefetch={false}
      data-reveal
      className={cn(
        revealClass,
        "group flex min-h-[168px] flex-col",
        "rounded-[4px_28px_4px_4px] border border-border bg-card p-5 sm:p-6",
        "transition-colors hover:border-brand-teal hover:bg-secondary",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {job.department[locale]}
        </span>
        <span
          className={cn(
            buttonVariants({ variant: "outline", size: "icon-sm" }),
            "size-8 rounded-full border-foreground/25 text-foreground/45 bg-transparent pointer-events-none",
            "group-hover:border-brand-teal group-hover:text-brand-teal",
          )}
          aria-hidden
        >
          <ArrowUpRight className="size-3.5" />
        </span>
      </div>

      <h3 className="mt-2 font-serif text-xl sm:text-2xl font-semibold leading-snug tracking-tight text-brand-navy/80 text-balance max-w-[28ch]">
        {job.title[locale]}
      </h3>

      <span className="mt-auto pt-4 text-sm text-muted-foreground">
        {[job.location[locale], job.type[locale]].join(" · ")}
      </span>
    </Link>
  );
}

type Props = {
  locale: Locale;
  content: Pick<
    HomeContent,
    | "careers_eyebrow"
    | "careers_h"
    | "careers_p"
    | "careers_areas"
    | "all_jobs"
  >;
  jobs: readonly PublicJobSummary[];
  jobsTotal: number;
  jobsFailed: boolean;
  emptyMessage: string;
  unavailableMessage: string;
  jobsPending?: boolean;
  pendingMessage?: string;
};

export function HomeCareersPreview({
  locale,
  content: t,
  jobs,
  jobsTotal,
  jobsFailed,
  emptyMessage,
  unavailableMessage,
  jobsPending = false,
  pendingMessage = "",
}: Props) {
  return (
    <section
      id="careers"
      className={homeSectionWithRuleClass}
      aria-labelledby="home-careers-heading"
    >
      <SectionHeader
        eyebrow={t.careers_eyebrow}
        title={t.careers_h}
        description={t.careers_p}
        headingId="home-careers-heading"
        titleSize="display"
        className="mb-6 sm:mb-8"
        action={
          <Link
            href={`/${locale}/careers`}
            prefetch={false}
            className={cn(
              buttonVariants({ variant: "default", size: "default" }),
              "shrink-0",
            )}
          >
            {t.all_jobs}
            {!jobsFailed && jobsTotal > 0 ? ` (${jobsTotal})` : null}
          </Link>
        }
      />

      <nav
        aria-label={locale === "zh" ? "业务领域职位" : "Roles by area"}
        className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-y-3 sm:gap-y-0 mb-10 sm:mb-12"
      >
        {t.careers_areas.map((area, index) => (
          <span key={area.filterValue} className="contents">
            {index > 0 ? (
              <span
                className="hidden sm:inline-block w-px h-5 mx-5 lg:mx-6 bg-brand-gold/50 shrink-0"
                aria-hidden
              />
            ) : null}
            <Link
              href={`/${locale}/careers?${new URLSearchParams({
                department: area.filterValue,
              })}`}
              prefetch={false}
              className="text-sm sm:text-[15px] font-medium text-foreground hover:text-brand-teal transition-colors"
            >
              {area.label}
            </Link>
          </span>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {jobsPending ? (
          <div className="md:col-span-2">
            <SectionSpinner label={pendingMessage} />
          </div>
        ) : null}
        {!jobsPending && jobsFailed && (
          <p
            className="md:col-span-2 text-sm text-muted-foreground"
            role="status"
          >
            {unavailableMessage}
          </p>
        )}
        {!jobsPending && !jobsFailed && jobs.length === 0 && (
          <p className="md:col-span-2 text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        )}
        {!jobsPending
          ? jobs.map((job) => (
              <HomeJobCard key={job.id} job={job} locale={locale} />
            ))
          : null}
      </div>
    </section>
  );
}
