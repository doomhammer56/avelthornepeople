"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import type { AdminLang } from "@/lib/admin/nav";
import { dashboardQueryOptions } from "@/lib/admin/queries";
import { parseDashboardRange } from "@/server/dashboard/contract";
import { dashboardContent } from "@/lib/admin/dashboardContent";
import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { DashboardOverview } from "./DashboardOverview";
import { AdminLink, useAdminLoading } from "./AdminNavigation";
import {
  AdminQueryFeedback,
  useAdminQuerySnapshot,
} from "./AdminQueryFeedback";

export function DashboardBoard({ lang }: { lang: AdminLang }) {
  const params = useSearchParams();
  let range;
  try {
    if (params.getAll("range").length > 1) throw new Error("Invalid range");
    range = parseDashboardRange(params.get("range") ?? undefined);
  } catch {
    /* Disable reads for invalid URL state. */
  }
  const metrics = useQuery({
    ...dashboardQueryOptions(range ?? 30),
    enabled: !!range,
    placeholderData: keepPreviousData,
  });
  const data = useAdminQuerySnapshot(
    metrics.data,
    metrics.isPlaceholderData,
    metrics.error,
  );
  useAdminLoading(!!range && metrics.isFetching && metrics.isPlaceholderData);
  if (!range)
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>{dashboardContent[lang].invalid}</span>
          <AdminLink
            queryNavigation
            href={`/admin?lang=${lang}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {dashboardContent[lang].retry}
          </AdminLink>
        </AlertDescription>
      </Alert>
    );
  // No data yet: the page still draws its real header, range tabs and labels,
  // with placeholders only where numbers and charts will go.
  if (!data && !metrics.isError)
    return <DashboardOverview range={range} lang={lang} />;
  return (
    <>
      <AdminQueryFeedback
        lang={lang}
        error={metrics.isError}
        hasData={!!data}
        retry={() => void metrics.refetch()}
      />
      {data && (
        <DashboardOverview
          metrics={data}
          range={data.period.range}
          lang={lang}
          onRefresh={() => metrics.refetch()}
          refreshing={metrics.isFetching}
        />
      )}
    </>
  );
}
