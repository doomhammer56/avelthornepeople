import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { can } from "@/lib/auth/permissions";
import { authLanguage, currentStaff } from "@/server/auth/pages";
import { DashboardBoard } from "@/components/admin/DashboardBoard";

export const metadata: Metadata = { title: "Dashboard | Staff console" };
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang = await authLanguage((await searchParams).lang);
  const staff = await currentStaff();
  if (!can(staff.role, "dashboard.read")) redirect(`/admin/jobs?lang=${lang}`);
  return <DashboardBoard lang={lang} />;
}
