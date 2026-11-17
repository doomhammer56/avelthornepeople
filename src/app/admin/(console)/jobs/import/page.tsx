import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authLanguage, currentStaff } from "@/server/auth/pages";
import { can } from "@/lib/auth/permissions";
import { JobImportBoard } from "@/components/admin/JobImportBoard";

export const metadata: Metadata = { title: "Import jobs | Staff console" };
export default async function ImportJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang = await authLanguage((await searchParams).lang),
    staff = await currentStaff();
  if (!can(staff.role, "jobs.write")) redirect(`/admin/jobs?lang=${lang}`);
  return <JobImportBoard lang={lang} />;
}
