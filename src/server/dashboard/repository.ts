import "server-only";
import type pg from "pg";
import { safeCount } from "./contract.ts";
import type { DashboardMetrics } from "./contract.ts";
import { normalizeSource, type TrafficSource } from "../analytics/source.ts";

export async function readDashboard(
  db: pg.PoolClient,
  period: DashboardMetrics["period"],
): Promise<DashboardMetrics> {
  // Independent aggregates in one statement share a snapshot and cannot fan out
  // counts through a jobs/applications/metrics join.
  const {
    rows: [row],
  } = await db.query(
    `WITH
    job_counts AS (
      SELECT count(*) AS total,
        count(*) FILTER (WHERE status='PUBLISHED' AND published_content IS NOT NULL
          AND approved_at IS NOT NULL AND published_version IS NOT NULL
          AND publish_at <= statement_timestamp()
          AND (close_at IS NULL OR close_at > statement_timestamp())) AS live,
        count(*) FILTER (WHERE status='PUBLISHED' AND close_at <= statement_timestamp()) AS expired
      FROM portal.jobs
    ), daily AS (
      SELECT (submitted_at AT TIME ZONE 'UTC')::date AS day, count(*) AS total,
        count(*) FILTER (WHERE submission_channel='PUBLIC_SITE') AS public_site,
        count(*) FILTER (WHERE submission_channel IS NULL) AS unknown_channel
      FROM portal.applications
      WHERE intake_state='CONFIRMED' AND submitted_at >= $1::timestamptz AND submitted_at < $2::timestamptz
      GROUP BY 1
    ), sources AS (
      SELECT source, sum(page_views) AS total FROM portal.daily_metrics
      WHERE metric_date >= ($1::timestamptz AT TIME ZONE 'UTC')::date
        AND metric_date <= ($2::timestamptz AT TIME ZONE 'UTC')::date
        AND page_key='job_detail' AND job_id IS NOT NULL
      GROUP BY source
    )
    SELECT j.total, j.live, j.expired,
      (SELECT started_at FROM portal_private.analytics_state WHERE singleton) AS started_at,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('date',day,'value',total::text,
        'publicSite',public_site::text,'unknown',unknown_channel::text) ORDER BY day) FROM daily),'[]') AS daily,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('source',source,'count',total::text)) FROM sources),'[]') AS sources
    FROM job_counts j`,
    [period.start, period.end],
  );
  const daily = new Map<string, number>();
  let applications = 0,
    publicSiteApplications = 0,
    unknownChannelApplications = 0;
  for (const item of row.daily) {
    const count = safeCount(item.value);
    daily.set(item.date, count);
    applications += count;
    publicSiteApplications += safeCount(item.publicSite);
    unknownChannelApplications += safeCount(item.unknown);
  }
  const grouped = new Map<TrafficSource, number>();
  for (const item of row.sources) {
    const key = normalizeSource(item.source);
    grouped.set(
      key,
      safeCount((grouped.get(key) ?? 0) + safeCount(item.count)),
    );
  }
  const detailViews = safeCount(
    [...grouped.values()].reduce((sum, n) => sum + n, 0),
  );
  const startedAt = row.started_at
    ? new Date(row.started_at).toISOString()
    : null;
  const coverage = !startedAt
    ? "disabled"
    : startedAt > period.start
      ? "partial"
      : "full";
  const dailyApplications = Array.from({ length: period.range }, (_, index) => {
    const day = new Date(period.start);
    day.setUTCDate(day.getUTCDate() + index);
    const date = day.toISOString().slice(0, 10);
    return { date, value: daily.get(date) ?? 0 };
  });
  return {
    period,
    generatedAt: period.end,
    tracking: { startedAt, coverage },
    totalJobs: safeCount(row.total),
    liveJobs: safeCount(row.live),
    expiredLiveJobs: safeCount(row.expired),
    detailViews,
    applications: safeCount(applications),
    publicSiteApplications: safeCount(publicSiteApplications),
    unknownChannelApplications: safeCount(unknownChannelApplications),
    conversionRate:
      detailViews && coverage === "full" && !unknownChannelApplications
        ? (publicSiteApplications / detailViews) * 100
        : null,
    dailyApplications,
    sources: [...grouped]
      .map(([key, count]) => ({
        key,
        count,
        share: detailViews ? (count / detailViews) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
  };
}
