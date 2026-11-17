import type { Metadata } from "next";
import { authLanguage, currentStaff } from "@/server/auth/pages";
import { can } from "@/lib/auth/permissions";
import { consoleResult } from "@/server/admin/result";
import { AdminDataNotice } from "@/components/admin/AdminDataNotice";
import { JobsBoard } from "@/components/admin/JobsBoard";

export const metadata: Metadata = { title: "Jobs | Staff console" };
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang = await authLanguage((await searchParams).lang);
  const result = await consoleResult(currentStaff);
  if (!result.ok) return <AdminDataNotice lang={lang} kind={result.kind} />;
  if (!can(result.data.role, "jobs.read"))
    return <AdminDataNotice lang={lang} kind="restricted" />;
  return (
    <JobsBoard lang={lang} canEdit={can(result.data.role, "jobs.write")} />
  );
}
