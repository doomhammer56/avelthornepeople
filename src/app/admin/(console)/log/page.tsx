import { ChevronDown, CircleAlert, FilterX } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { FormField } from "@/components/admin/ui/form-field";
import { AdminPageHeader } from "@/components/admin/ui/page-header";
import { InstantFilterForm } from "@/components/admin/InstantFilterForm";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import type { Metadata } from "next";
import { AdminDataNotice } from "@/components/admin/AdminDataNotice";
import { AuditLogTable } from "@/components/admin/AuditLogTable";
import { RoutePagination } from "@/components/admin/RoutePagination";
import { getAdminAccounts } from "@/lib/admin/adminAccounts";
import { consoleResult } from "@/server/admin/result";
import { authLanguage } from "@/server/auth/pages";
import { getAdminAuditLog } from "@/lib/admin/adminAuditLog";
import { auditLogContent } from "@/lib/admin/auditLogContent";
import {
  auditActionLabels,
  auditObjectLabels,
} from "@/lib/admin/auditLogLabels";
import { auditFilters } from "@/server/audit/contract";

export const metadata: Metadata = { title: "Audit log | Staff console" };
type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const types = [
  "JOB",
  "APPLICATION",
  "CANDIDATE",
  "CONTENT",
  "CONTENT_IMAGE",
  "STAFF_PROFILE",
  "AUTH_ACCOUNT",
  "DEPARTMENT",
  "LOCATION",
  "CONTACT_MESSAGE",
];
export default async function AuditLogPage({ searchParams }: Props) {
  const query = await searchParams;
  const lang = await authLanguage(
    typeof query.lang === "string" ? query.lang : undefined,
  );
  const t = auditLogContent[lang];
  const raw = Object.fromEntries(
    Object.entries(query).filter(
      ([key, value]) => key !== "lang" && value !== "" && value !== undefined,
    ),
  );
  // Without JavaScript the actor dropdown submits "system" as an actor ID.
  if (raw.actorId === "system") {
    delete raw.actorId;
    raw.actor = "system";
  }
  const parsed = auditFilters.safeParse(raw);
  if (!parsed.success)
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertDescription>{t.invalid}</AlertDescription>
      </Alert>
    );
  const filters = parsed.data;
  const result = await consoleResult(() => getAdminAuditLog(filters));
  if (!result.ok) return <AdminDataNotice lang={lang} kind={result.kind} />;
  const data = result.data;
  // Names for the actor dropdown. The filter still works by ID if this is unavailable.
  const directory = await consoleResult(() => getAdminAccounts(1));
  const staffOptions = directory.ok ? directory.data.accounts : [];
  // Active filters carry over when the page or page size changes.
  const filterParams = new URLSearchParams({ lang });
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && key !== "page" && key !== "pageSize")
      filterParams.set(key, String(value));
  return (
    <>
      <AdminPageHeader title={t.title} description={t.subtitle} />
      {/* Keep everyday filters compact and apply selections through the existing backend query.
          Advanced identifiers wait until complete, with native submission available before hydration. */}
      <Card variant="panel" className="p-5">
        <InstantFilterForm
          action="/admin/log"
          lang={lang}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="pageSize" value={filters.pageSize} />
          <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
            <FormField label={t.columns.object} htmlFor="log-object">
              <NativeSelect
                className="w-full"
                id="log-object"
                name="objectType"
                defaultValue={filters.objectType ?? ""}
              >
                <NativeSelectOption value="">{t.all}</NativeSelectOption>
                {types.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {auditObjectLabels[type]?.[lang] ?? type}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label={t.action} htmlFor="log-action">
              <NativeSelect
                className="w-full"
                id="log-action"
                name="action"
                defaultValue={filters.action ?? ""}
              >
                <NativeSelectOption value="">{t.anyAction}</NativeSelectOption>
                {Object.entries(auditActionLabels).map(([code, label]) => (
                  <NativeSelectOption key={code} value={code}>
                    {label[lang]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label={t.actor} htmlFor="log-actor">
              <NativeSelect
                className="w-full"
                id="log-actor"
                name="actorId"
                defaultValue={
                  filters.actor === "system"
                    ? "system"
                    : (filters.actorId ?? "")
                }
              >
                <NativeSelectOption value="">{t.anyActor}</NativeSelectOption>
                <NativeSelectOption value="system">{t.system}</NativeSelectOption>
                {staffOptions.map((member) => (
                  <NativeSelectOption key={member.id} value={member.id}>
                    {member.name}
                    {member.active
                      ? ""
                      : lang === "zh"
                        ? "（已停用）"
                        : " (deactivated)"}
                  </NativeSelectOption>
                ))}
                {filters.actorId &&
                !staffOptions.some((member) => member.id === filters.actorId) ? (
                  <NativeSelectOption value={filters.actorId}>
                    {t.selectedActor}
                  </NativeSelectOption>
                ) : null}
              </NativeSelect>
            </FormField>
            <div className="flex items-center gap-2">
              <Button type="submit" data-filter-submit>
                {t.filter}
              </Button>
              <Link
                href={"/admin/log?lang=" + lang}
                className={buttonVariants({ variant: "ghost" })}
              >
                <FilterX aria-hidden="true" />
                {t.clear}
              </Link>
            </div>
          </div>
          <Collapsible defaultOpen={!!filters.objectId}>
            <CollapsibleTrigger className="group/advanced flex w-fit cursor-pointer items-center gap-1.5 py-1 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              {t.advanced}
              <ChevronDown
                className="size-4 transition-transform group-data-[panel-open]/advanced:rotate-180"
                aria-hidden="true"
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 max-w-md">
              <FormField label={t.object} htmlFor="log-object-id">
                <Input
                  id="log-object-id"
                  name="objectId"
                  maxLength={36}
                  pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                  defaultValue={filters.objectId}
                />
              </FormField>
            </CollapsibleContent>
          </Collapsible>
        </InstantFilterForm>
      </Card>
      <AuditLogTable
        entries={data.entries}
        lang={lang}
        footer={
          <RoutePagination
            lang={lang}
            path="/admin/log"
            page={data.page}
            pageSize={data.pageSize}
            rowCount={data.entries.length}
            hasMore={data.hasMore}
            params={filterParams.toString()}
          />
        }
      />
    </>
  );
}
