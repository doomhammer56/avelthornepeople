import { Card } from "@/components/ui/card";
import { ShieldOff } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/ui/page-header";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { can } from "@/lib/auth/permissions";
import { RoutePagination } from "@/components/admin/RoutePagination";
import { AdminDataNotice } from "@/components/admin/AdminDataNotice";
import { consoleResult } from "@/server/admin/result";
import { StaffInviteDialog } from "@/components/admin/StaffInviteDialog";
import type { Metadata } from "next";
import { authLanguage, currentStaff } from "@/server/auth/pages";
import { getAdminAccounts } from "@/lib/admin/adminAccounts";
import { accountsContent } from "@/lib/admin/accountsContent";
import { AccountsBoard } from "@/components/admin/AccountsBoard";

export const metadata: Metadata = { title: "Accounts & roles | Staff console" };

type Props = { searchParams: Promise<{ lang?: string; page?: string }> };

export default async function AccountsPage({ searchParams }: Props) {
  const query = await searchParams;
  const lang = await authLanguage(query.lang);
  const staff = await currentStaff();
  const t = accountsContent[lang];

  // The nav already hides this link for non-Admin roles; this is the real
  // enforcement, since a direct URL visit must be blocked either way.
  if (!can(staff.role, "team.read"))
    return (
      <EmptyState icon={ShieldOff} title={t.noPermTitle} description={t.noPermBody} />
    );

  const page = /^[1-9]\d{0,4}$/.test(query.page ?? "1")
    ? Number(query.page ?? 1)
    : 1;
  const result = await consoleResult(() => getAdminAccounts(page));
  if (!result.ok) return <AdminDataNotice lang={lang} kind={result.kind} />;
  const { accounts, hasMore } = result.data;

  return (
    <>
      <AdminPageHeader
        title={t.title}
        description={t.subtitle}
        actions={<StaffInviteDialog lang={lang} />}
      />
      <AccountsBoard accounts={accounts} lang={lang} currentUserId={staff.id} />
      <Card variant="panel" className="-mt-3">
        <RoutePagination
          lang={lang}
          path="/admin/accounts"
          page={page}
          pageSize={50}
          rowCount={accounts.length}
          hasMore={hasMore}
          params={new URLSearchParams({ lang }).toString()}
          pageSizeParam={false}
        />
      </Card>
    </>
  );
}
