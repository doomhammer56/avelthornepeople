"use client";

import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { parseQuery } from "@/server/applications/contract";
import { parseDashboardRange } from "@/server/dashboard/contract";
import { accountsContent } from "@/lib/admin/accountsContent";
import { applicationsContent } from "@/lib/admin/applicationsContent";
import { staffUiText } from "@/lib/admin/staffContent";
import { auditLogContent } from "@/lib/admin/auditLogContent";
import { jobEditorContent } from "@/lib/admin/jobEditorContent";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminContext } from "./AdminContext";
import { AdminLink as Link, useAdminLoading } from "./AdminNavigation";
import { AdminPageSkeleton } from "./AdminPageSkeleton";
import { ApplicationDetailBoard } from "./ApplicationDetailBoard";
import { ApplicationsBoard } from "./ApplicationsBoard";
import { ApplicationsRefreshButton } from "./ApplicationsRefreshButton";
import { DashboardOverview } from "./DashboardOverview";
import { JobImportBoard } from "./JobImportBoard";
import { JobsBoard } from "./JobsBoard";
import { SettingsBoard } from "./SettingsBoard";
import { StaffInviteDialog } from "./StaffInviteDialog";
import { TimeZonePreference } from "./TimeZonePreference";
import { FormField } from "./ui/form-field";
import { AdminPageHeader } from "./ui/page-header";
import { Bone, TableRowsSkeleton } from "./ui/data-skeleton";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Route-level fallback. Everything that does not depend on data (titles,
// descriptions, buttons the role may use, tab and column labels) is drawn for
// real; skeletons only stand in for rows, counts and charts. Boards that load
// their own data through the query cache start fetching right here, so the
// request is already in flight by the time the page itself arrives.
export function AdminRouteLoading() {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const search = useSearchParams();
  const { lang, role } = useAdminContext();
  useAdminLoading(true);

  const content = useMemo(() => {
    if (pathname === "/admin") {
      if (!can(role, "dashboard.read"))
        return <AdminPageSkeleton variant="dashboard" lang={lang} />;
      let range: 7 | 30 | 90 = 30;
      try {
        range = parseDashboardRange(search.get("range") ?? undefined);
      } catch {
        /* The page reports an invalid range itself. */
      }
      return <DashboardOverview range={range} lang={lang} />;
    }
    if (pathname === "/admin/jobs") {
      return <JobsBoard lang={lang} canEdit={can(role, "jobs.write")} />;
    }
    if (pathname === "/admin/jobs/import") {
      return can(role, "jobs.write") ? (
        <JobImportBoard lang={lang} />
      ) : (
        <AdminPageSkeleton variant="editor" lang={lang} />
      );
    }
    if (/^\/admin\/jobs\/(new|[^/]+\/edit)$/.test(pathname)) {
      const t = jobEditorContent[lang];
      return (
        <div className="flex w-full min-w-0 flex-col gap-5">
          <AdminPageHeader
            above={
              <Link
                href={`/admin/jobs?lang=${lang}`}
                className={buttonVariants({
                  variant: "ghost",
                  size: "sm",
                  className: "-ml-3 w-fit",
                })}
              >
                <ArrowLeft aria-hidden="true" />
                {t.back}
              </Link>
            }
            title={
              pathname.endsWith("/new") ? (
                t.newHeading
              ) : (
                <Bone width={260} height={26} />
              )
            }
            description={<Bone width={90} height={20} />}
          />
          <AdminPageSkeleton variant="editor" lang={lang} showHeader={false} />
        </div>
      );
    }
    if (pathname === "/admin/applications") {
      if (!can(role, "applications.read"))
        return <AdminPageSkeleton variant="applications" lang={lang} />;
      const t = applicationsContent[lang];
      const raw = new URLSearchParams();
      for (const [key, value] of search.entries())
        raw.append(key === "job" ? "jobId" : key, value);
      let query;
      try {
        query = parseQuery(raw);
      } catch {
        /* Invalid filters are reported by the page. */
      }
      return (
        <>
          <AdminPageHeader
            title={t.title}
            description={t.subtitle}
            actions={<ApplicationsRefreshButton lang={lang} />}
          />
          {query ? (
            <ApplicationsBoard
              query={query}
              lang={lang}
              canEdit={can(role, "applications.write")}
            />
          ) : null}
        </>
      );
    }
    if (
      uuid.test(params.id ?? "") &&
      pathname.startsWith("/admin/applications/")
    ) {
      if (!can(role, "applications.read"))
        return <AdminPageSkeleton variant="detail" lang={lang} />;
      const back = search.get("back");
      return (
        <ApplicationDetailBoard
          id={params.id!}
          lang={lang}
          back={
            back?.startsWith("/admin/applications?")
              ? back
              : `/admin/applications?lang=${lang}`
          }
        />
      );
    }
    if (pathname === "/admin/accounts") {
      const t = accountsContent[lang];
      return (
        <>
          <AdminPageHeader
            title={t.title}
            description={t.subtitle}
            actions={
              can(role, "team.manage") ? (
                <StaffInviteDialog lang={lang} />
              ) : null
            }
          />
          <Card variant="panel" className="overflow-hidden">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead>{t.columns.member}</TableHead>
                  <TableHead>{t.columns.role}</TableHead>
                  <TableHead>{t.columns.scope}</TableHead>
                  <TableHead>{t.columns.lastLogin}</TableHead>
                  <TableHead>{t.columns.status}</TableHead>
                  <TableHead className="text-right">
                    {staffUiText[lang].actions}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRowsSkeleton columns={7} leading trailingRight />
              </TableBody>
            </Table>
          </Card>
        </>
      );
    }
    if (pathname === "/admin/settings") {
      return (
        <SettingsBoard
          lang={lang}
          canEdit={can(role, "settings.write")}
          preferences={<TimeZonePreference lang={lang} />}
        />
      );
    }
    if (pathname === "/admin/log") {
      const t = auditLogContent[lang];
      return (
        <>
          <AdminPageHeader title={t.title} description={t.subtitle} />
          <Card variant="panel" className="p-5">
            <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
              {[t.columns.object, t.action, t.actor].map((label) => (
                <FormField key={label} label={label}>
                  <Bone height={36} />
                </FormField>
              ))}
              <Bone width={140} height={36} />
            </div>
          </Card>
          <Card variant="panel" className="overflow-hidden">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.columns.time}</TableHead>
                  <TableHead>{t.columns.actor}</TableHead>
                  <TableHead>{t.columns.action}</TableHead>
                  <TableHead>{t.columns.object}</TableHead>
                  <TableHead>{t.details}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRowsSkeleton columns={5} rows={8} />
              </TableBody>
            </Table>
          </Card>
        </>
      );
    }
    return <AdminPageSkeleton lang={lang} />;
  }, [pathname, params.id, search, lang, role]);

  return (
    <div className="flex min-w-0 flex-col gap-5" data-route-loading>
      {content}
    </div>
  );
}
