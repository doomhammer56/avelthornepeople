import { can } from "@/lib/auth/permissions";
import { AdminDataNotice } from "@/components/admin/AdminDataNotice";
import { consoleResult } from "@/server/admin/result";
import type { Metadata } from "next";
import { authLanguage, currentStaff } from "@/server/auth/pages";
import { getAdminContentBlocks } from "@/lib/admin/adminContentBlocks";
import { contentContent } from "@/lib/admin/contentContent";
import { ContentBlocksBoard } from "@/components/admin/ContentBlocksBoard";
import { getPublicJobs } from "@/lib/getPublicJobs";

export const metadata: Metadata = { title: "Company content | Staff console" };

type Props = { searchParams: Promise<{ lang?: string }> };

// Supply the visual editor with authorized drafts and the same public role summaries as Home.
// Read-only preview data does not change any content or job management permissions.
export default async function ContentPage({ searchParams }: Props) {
  const lang = await authLanguage((await searchParams).lang);
  const t = contentContent[lang];
  const [result, jobs] = await Promise.all([
    consoleResult(() => getAdminContentBlocks()),
    getPublicJobs(new URLSearchParams({ pageSize: "6" })),
  ]);
  if (!result.ok) return <AdminDataNotice lang={lang} kind={result.kind} />;
  const { blocks } = result.data;
  const staff = await currentStaff();

  return (
    <>
      <ContentBlocksBoard
        blocks={blocks}
        lang={lang}
        canEdit={can(staff.role, "content.write")}
        title={t.title}
        jobs={jobs.jobs}
        jobsTotal={jobs.total}
        jobsFailed={jobs.failed}
      />
    </>
  );
}
