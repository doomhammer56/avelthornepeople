import { AdminLink as Link } from "./AdminNavigation";
import {
  BriefcaseBusiness,
  Eye,
  FileCheck2,
  Percent,
  Clock3,
} from "lucide-react";
import type {
  DashboardMetrics,
  DashboardRange,
} from "@/lib/admin/dashboardMetrics";
import type { AdminLang } from "@/lib/admin/nav";
import { dashboardContent } from "@/lib/admin/dashboardContent";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminRefreshButton } from "./AdminRefreshButton";
import { filterPillClass } from "./ui/filter-controls";
import { KpiCard, KpiGrid } from "./ui/kpi-card";
import { AdminPageHeader } from "./ui/page-header";
import { SectionCard } from "./ui/section-card";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { Bone } from "./ui/data-skeleton";

// Recharts loads on demand so the rest of the console stays light.
const DailyApplicationsChart = dynamic(
  () => import("./DashboardCharts").then((m) => m.DailyApplicationsChart),
  { ssr: false, loading: () => <Skeleton className="h-56 w-full" /> },
);
const SourcesChart = dynamic(
  () => import("./DashboardCharts").then((m) => m.SourcesChart),
  { ssr: false, loading: () => <Skeleton className="h-44 w-full" /> },
);

type Props = {
  /** Undefined while loading: static labels render, values show placeholders. */
  metrics?: DashboardMetrics;
  range: DashboardRange;
  lang: AdminLang;
  onRefresh?: () => Promise<unknown>;
  refreshing?: boolean;
};

// Present the existing dashboard response without fetching or changing metrics.
// Keeping rendering separate preserves the page's authorization and data boundary.
export function DashboardOverview({
  metrics,
  range,
  lang,
  onRefresh,
  refreshing,
}: Props) {
  const t = dashboardContent[lang];
  const number = (value: number) =>
    value.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
  const date = (value: string) =>
    new Date(value).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  const time = (value: string) =>
    new Date(value).toLocaleString(lang === "zh" ? "zh-CN" : "en-GB", {
      timeZone: "UTC",
    }) + " UTC";
  const m = metrics;
  const loading = !m;
  const cards = loading
    ? [
        { title: t.jobs, icon: BriefcaseBusiness },
        { title: t.views, icon: Eye },
        { title: t.applications, icon: FileCheck2 },
        { title: t.conversion, icon: Percent },
        { title: t.expired, icon: Clock3 },
      ].map((card) => ({
        ...card,
        value: <Bone width={64} height={30} />,
        note: <Bone width="70%" height={11} />,
        warning: false,
      }))
    : [
        {
          title: t.jobs,
          value: number(m.liveJobs),
          note: t.total(m.totalJobs),
          icon: BriefcaseBusiness,
        },
        {
          title: t.views,
          value:
            m.tracking.coverage === "disabled" ? "—" : number(m.detailViews),
          note: t.pageViews,
          icon: Eye,
        },
        {
          title: t.applications,
          value: number(m.applications),
          note: t.publicSite(m.publicSiteApplications),
          icon: FileCheck2,
        },
        {
          title: t.conversion,
          value:
            m.conversionRate === null ? "—" : m.conversionRate.toFixed(1) + "%",
          note:
            m.tracking.coverage === "disabled"
              ? t.disabled
              : m.tracking.coverage === "partial"
                ? t.partial
                : m.unknownChannelApplications > 0
                  ? t.unknown
                  : t.conversionNote,
          icon: Percent,
        },
        {
          title: t.expired,
          value: number(m.expiredLiveJobs),
          note: "",
          icon: Clock3,
          warning: m.expiredLiveJobs > 0,
        },
      ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <AdminPageHeader
        title={t.title}
        actions={
          <AdminRefreshButton
            label={t.refresh}
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
        }
      />
      <Card
        variant="panel"
        className="flex-row flex-wrap items-center justify-between gap-4 px-5 py-4"
      >
        <div>
          <span className="text-[13px] font-medium text-foreground/80">
            {t.days(range)}
          </span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {m ? (
              <>
                {date(m.period.start)} – {date(m.period.end)}
              </>
            ) : (
              <Bone width={150} height={11} />
            )}
          </p>
        </div>
        <nav
          className="flex flex-wrap items-center gap-2"
          aria-label={t.rangeLabel}
        >
          {([7, 30, 90] as const).map((days) => (
            <Link
              queryNavigation
              key={days}
              aria-current={range === days ? "page" : undefined}
              aria-label={t.days(days)}
              href={`/admin?range=${days}&lang=${lang}`}
              className={filterPillClass(range === days)}
            >
              {t.ranges[days]}
            </Link>
          ))}
        </nav>
      </Card>
      <KpiGrid>
        {cards.map((card) => (
          <KpiCard
            key={card.title}
            label={card.title}
            value={card.value}
            note={card.note}
            icon={card.icon}
            warning={card.warning}
          />
        ))}
      </KpiGrid>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-3">
        <SectionCard
          title={t.daily}
          headingId="dashboard-daily"
          actions={
            <span className="text-xs text-muted-foreground">
              {t.days(range)} · UTC
            </span>
          }
          bodyClassName="flex flex-col gap-4"
        >
          {m && m.applications === 0 ? (
            <p className="m-0 text-[13px] text-muted-foreground">{t.empty}</p>
          ) : null}
          {m ? (
            <DailyApplicationsChart days={m.dailyApplications} lang={lang} />
          ) : (
            <Skeleton className="h-56 w-full" />
          )}
          <Collapsible>
            <CollapsibleTrigger className="group/daily flex w-fit cursor-pointer items-center gap-1.5 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              {t.viewDaily}
              <ChevronDown
                className="size-4 transition-transform group-data-[panel-open]/daily:rotate-180"
                aria-hidden="true"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Table className="mt-3">
                <caption className="sr-only">{t.daily} · UTC</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t.date}</TableHead>
                    <TableHead scope="col" className="text-right">
                      {t.applications}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(m?.dailyApplications ?? []).map((day) => (
                    <TableRow key={day.date}>
                      <TableHead scope="row" className="bg-transparent">
                        {day.date}
                      </TableHead>
                      <TableCell className="text-right tabular-nums">
                        {number(day.value)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CollapsibleContent>
          </Collapsible>
        </SectionCard>
        <SectionCard
          title={t.sources}
          headingId="dashboard-sources"
          bodyClassName="flex flex-col gap-4"
        >
          {!m ? (
            <Skeleton className="h-44 w-full" />
          ) : m.tracking.coverage === "disabled" ? (
            <p className="m-0 text-[13px] text-muted-foreground">
              {t.disabled}
            </p>
          ) : m.sources.length === 0 ? (
            <p className="m-0 text-[13px] text-muted-foreground">{t.empty}</p>
          ) : (
            <SourcesChart sources={m.sources} lang={lang} />
          )}
        </SectionCard>
      </div>
      <p className="m-0 text-xs text-muted-foreground">
        {t.updated}:{" "}
        {m ? time(m.generatedAt) : <Bone width={140} height={11} />}
      </p>
    </div>
  );
}
