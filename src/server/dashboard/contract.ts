import type { TrafficSource } from "../analytics/source.ts";
export type DashboardRange = 7 | 30 | 90;
export function parseDashboardRange(value: string | undefined): DashboardRange {
  if (value === undefined) return 30;
  if (value === "7" || value === "30" || value === "90")
    return Number(value) as DashboardRange;
  throw new Error("Invalid dashboard range");
}

export function dashboardPeriod(range: DashboardRange, now: Date) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - range + 1);
  return {
    range,
    start: start.toISOString(),
    end: now.toISOString(),
    timezone: "UTC" as const,
  };
}

export function safeCount(value: string | number | bigint): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error("Invalid metric count");
  return count;
}

export type DashboardMetrics = {
  period: ReturnType<typeof dashboardPeriod>;
  generatedAt: string;
  tracking: {
    startedAt: string | null;
    coverage: "disabled" | "partial" | "full";
  };
  totalJobs: number;
  liveJobs: number;
  expiredLiveJobs: number;
  detailViews: number;
  applications: number;
  publicSiteApplications: number;
  unknownChannelApplications: number;
  conversionRate: number | null;
  dailyApplications: { date: string; value: number }[];
  sources: { key: TrafficSource; count: number; share: number }[];
};
