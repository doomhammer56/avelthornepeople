import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { authLanguage, currentStaff } from "@/server/auth/pages";
import { can } from "@/lib/auth/permissions";
import { ApplicationDetailBoard } from "@/components/admin/ApplicationDetailBoard";
import { AdminDataNotice } from "@/components/admin/AdminDataNotice";

export const metadata: Metadata = { title: "Application | Staff console" };
export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lang?: string; back?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const lang = await authLanguage(query.lang);
  const staff = await currentStaff();
  if (!can(staff.role, "applications.read"))
    return <AdminDataNotice lang={lang} kind="restricted" />;
  const back = query.back?.startsWith("/admin/applications?")
    ? query.back
    : `/admin/applications?lang=${lang}`;
  return <ApplicationDetailBoard key={id} id={id} lang={lang} back={back} />;
}
