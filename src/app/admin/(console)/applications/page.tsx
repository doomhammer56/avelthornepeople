import type { Metadata } from "next";
import { AdminDataNotice } from "@/components/admin/AdminDataNotice";
import { consoleResult } from "@/server/admin/result";
import { authLanguage, currentStaff } from "@/server/auth/pages";
import { can } from "@/lib/auth/permissions";
import { parseQuery } from "@/server/applications/contract";
import { applicationsContent } from "@/lib/admin/applicationsContent";
import { AdminPageHeader } from "@/components/admin/ui/page-header";
import { ApplicationsRefreshButton } from "@/components/admin/ApplicationsRefreshButton";
import { ApplicationsBoard } from "@/components/admin/ApplicationsBoard";
export const metadata: Metadata = { title: "Applications | Staff console" };
export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    lang = await authLanguage(
      typeof raw.lang === "string" ? raw.lang : undefined,
    ),
    t = applicationsContent[lang];
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw))
    for (const v of Array.isArray(value) ? value : value ? [value] : [])
      params.append(key === "job" ? "jobId" : key, v);
  const result = await consoleResult(async () => {
    const staff = await currentStaff();
    return {
      query: parseQuery(params),
      allowed: can(staff.role, "applications.read"),
      canEdit: can(staff.role, "applications.write"),
    };
  });
  if (!result.ok) return <AdminDataNotice lang={lang} kind={result.kind} />;
  const { query, allowed, canEdit } = result.data;
  if (!allowed) return <AdminDataNotice lang={lang} kind="restricted" />;
  return (
    <>
      <AdminPageHeader
        title={t.title}
        description={t.subtitle}
        actions={<ApplicationsRefreshButton lang={lang} />}
      />
      <ApplicationsBoard
        key={params.toString()}
        query={query}
        lang={lang}
        canEdit={canEdit}
      />
    </>
  );
}
