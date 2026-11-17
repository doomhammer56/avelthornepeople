"use client";

import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { AdminLang } from "@/lib/admin/nav";
import { dashboardContent } from "@/lib/admin/dashboardContent";
import type { DashboardMetrics } from "@/lib/admin/dashboardMetrics";

type Daily = DashboardMetrics["dailyApplications"];
type Sources = DashboardMetrics["sources"];

// Recharts ships as one lazy chunk (see DashboardOverview), so the rest of
// the console never pays for it. Dates are UTC to match the reporting period.
export function DailyApplicationsChart({
  days,
  lang,
}: {
  days: Daily;
  lang: AdminLang;
}) {
  const t = dashboardContent[lang];
  const locale = lang === "zh" ? "zh-CN" : "en-GB";
  const config = {
    value: { label: t.applications, color: "var(--chart-1)" },
  } satisfies ChartConfig;
  const full = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const tick = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  const at = (date: string) => new Date(`${date}T00:00:00Z`);

  return (
    <ChartContainer
      config={config}
      className="aspect-auto h-56 w-full justify-start"
      role="img"
      aria-label={`${t.daily} · UTC`}
    >
      <AreaChart data={days} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="daily-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={days.length <= 7 ? 8 : 28}
          tickFormatter={(value: string) =>
            days.length <= 7
              ? weekday.format(at(value))
              : tick.format(at(value))
          }
        />
        <YAxis
          width={32}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          domain={[0, (max: number) => Math.max(1, max)]}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(value) => `${full.format(at(String(value)))} · UTC`}
            />
          }
        />
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={2}
          fill="url(#daily-fill)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function SourcesChart({
  sources,
  lang,
}: {
  sources: Sources;
  lang: AdminLang;
}) {
  const t = dashboardContent[lang];
  const number = (value: number) =>
    value.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
  const config = Object.fromEntries(
    sources.map((item, index) => [
      item.key,
      { label: t[item.key], color: `var(--chart-${(index % 5) + 1})` },
    ]),
  ) satisfies ChartConfig;
  const total = sources.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <ChartContainer
        config={config}
        className="aspect-square h-44 shrink-0"
        role="img"
        aria-label={t.sources}
      >
        <PieChart>
          <ChartTooltip
            content={<ChartTooltipContent hideLabel nameKey="key" />}
          />
          <Pie
            data={sources}
            dataKey="count"
            nameKey="key"
            innerRadius={50}
            outerRadius={78}
            paddingAngle={2}
            strokeWidth={0}
          >
            {sources.map((item) => (
              <Cell key={item.key} fill={`var(--color-${item.key})`} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="m-0 flex w-full min-w-0 flex-1 list-none flex-col gap-2.5 p-0">
        {sources.map((item, index) => (
          <li
            key={item.key}
            className="flex items-center justify-between gap-3 text-[13px]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: `var(--chart-${(index % 5) + 1})` }}
                aria-hidden="true"
              />
              <span className="truncate">{t[item.key]}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {number(item.count)} · {item.share.toFixed(1)}%
            </span>
          </li>
        ))}
        <li className="mt-1 flex justify-between gap-3 border-t border-border pt-2 text-xs text-muted-foreground">
          <span>{t.applications}</span>
          <span className="tabular-nums">{number(total)}</span>
        </li>
      </ul>
    </div>
  );
}
