import { can } from "@/lib/auth/permissions";
import { AdminDataNotice } from "@/components/admin/AdminDataNotice";
import { consoleResult } from "@/server/admin/result";
import type { Metadata } from "next";
import { authLanguage, currentStaff } from "@/server/auth/pages";
import { getAdminSettings } from "@/lib/admin/adminSettings";
import { settingsContent } from "@/lib/admin/settingsContent";
import { ShieldOff } from "lucide-react";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { SettingsBoard } from "@/components/admin/SettingsBoard";
import { TimeZonePreference } from "@/components/admin/TimeZonePreference";

export const metadata: Metadata = { title: "Settings | Staff console" };

type Props = { searchParams: Promise<{ lang?: string }> };

export default async function SettingsPage({ searchParams }: Props) {
  const lang = await authLanguage((await searchParams).lang);
  const staff = await currentStaff();
  const t = settingsContent[lang];

  // Matches Accounts & roles: the nav hides this link for non-Admin roles,
  // this is the real enforcement for a direct URL visit.
  if (!can(staff.role, "settings.read"))
    return (
      <EmptyState
        icon={ShieldOff}
        title={t.noPermTitle}
        description={t.noPermBody}
      />
    );

  const result = await consoleResult(() => getAdminSettings());
  if (!result.ok) return <AdminDataNotice lang={lang} kind={result.kind} />;
  const settings = result.data;

  return (
    <>
      <SettingsBoard
        departments={settings.departments}
        locations={settings.locations}
        jobTypes={settings.jobTypes}
        experienceLevels={settings.experienceLevels}
        lang={lang}
        canEdit={can(staff.role, "settings.write")}
        preferences={<TimeZonePreference lang={lang} />}
      />
    </>
  );
}
