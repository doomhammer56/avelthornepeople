import { can } from "@/lib/auth/permissions";
import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { authLanguage, currentStaff } from "@/server/auth/pages";
import { getAdminSettings } from "@/lib/admin/adminSettings";
import { blankDraftJob } from "@/lib/admin/jobFields";
import { JobEditor } from "@/components/admin/JobEditor";
import { consoleResult } from "@/server/admin/result";
import { AdminDataNotice } from "@/components/admin/AdminDataNotice";
export const metadata: Metadata = { title: "New job | Staff console" };
export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang = await authLanguage((await searchParams).lang),
    staff = await currentStaff();
  if (!can(staff.role, "jobs.write")) redirect(`/admin/jobs?lang=${lang}`);
  const result = await consoleResult(getAdminSettings);
  if (!result.ok) return <AdminDataNotice lang={lang} kind={result.kind} />;
  return (
    <JobEditor
      job={blankDraftJob(randomUUID())}
      settings={result.data}
      lang={lang}
      isNew
      canEdit
      canPublish={can(staff.role, "jobs.publish")}
    />
  );
}
