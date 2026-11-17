import { can } from "@/lib/auth/permissions";
import { AdminDataNotice } from "@/components/admin/AdminDataNotice";
import { consoleResult } from "@/server/admin/result";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { authLanguage, currentStaff } from "@/server/auth/pages";
import { getAdminJob } from "@/lib/admin/adminJobs";
import { getAdminSettings } from "@/lib/admin/adminSettings";
import { JobEditor } from "@/components/admin/JobEditor";

export const metadata: Metadata = { title: "Edit job | Staff console" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string }>;
};

export default async function EditJobPage({ params, searchParams }: Props) {
  const { id } = await params;
  const lang = await authLanguage((await searchParams).lang);
  const result = await consoleResult(() =>
    Promise.all([getAdminJob(id), getAdminSettings()]),
  );
  if (!result.ok) return <AdminDataNotice lang={lang} kind={result.kind} />;
  const [job, settings] = result.data;
  const staff = await currentStaff();
  if (!job) notFound();

  return (
    <>
      <JobEditor
        key={`${job.id}:${job.version}`}
        job={job}
        settings={settings}
        lang={lang}
        isNew={false}
        canEdit={can(staff.role, "jobs.write")}
        canPublish={can(staff.role, "jobs.publish")}
      />
    </>
  );
}
