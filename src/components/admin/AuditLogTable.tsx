"use client";
import type { ReactNode } from "react";
import type { AuditEntry } from "@/server/audit/contract";
import type { AdminLang } from "@/lib/admin/nav";
import { useAdminTimeZone } from "@/lib/admin/useAdminTimeZone";
import { auditLogContent } from "@/lib/admin/auditLogContent";
import {
  auditActionLabel,
  auditObjectLabel,
  auditDetailLines,
} from "@/lib/admin/auditLogLabels";
import { ChevronDown, ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { EmptyState } from "./ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function AuditLogTable({
  entries,
  lang,
  footer,
}: {
  entries: AuditEntry[];
  lang: AdminLang;
  footer?: ReactNode;
}) {
  const t = auditLogContent[lang];
  const { timeZone } = useAdminTimeZone();
  const dates = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone,
  });
  return (
    <>
      <p className="m-0 text-[13px] text-muted-foreground">
        {t.zone}: {timeZone}
      </p>
      <Card variant="panel" className="overflow-hidden">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow>
              <TableHead>{t.columns.time}</TableHead>
              <TableHead>{t.columns.actor}</TableHead>
              <TableHead>{t.columns.action}</TableHead>
              <TableHead>{t.columns.object}</TableHead>
              <TableHead>{t.details}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id} className="align-top">
                <TableCell className="whitespace-nowrap">
                  <time dateTime={entry.at} title={entry.at}>
                    {dates.format(new Date(entry.at))}
                  </time>
                </TableCell>
                <TableCell>
                  {entry.actorId ? (entry.actorName ?? t.staff) : t.system}
                </TableCell>
                <TableCell className="text-foreground">
                  {auditActionLabel(entry.action, lang)}
                </TableCell>
                <TableCell>{auditObjectLabel(entry, lang)}</TableCell>
                <TableCell className="min-w-56">
                  <Collapsible>
                    <DetailsToggle>{t.details}</DetailsToggle>
                    <CollapsibleContent className="mt-2 flex flex-col gap-2">
                      {entry.detailsAvailable ? (
                        <ul className="m-0 list-disc space-y-1 ps-4 text-xs">
                          {auditDetailLines(entry.changes, lang).map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="m-0 text-xs text-muted-foreground">
                          {t.unavailable}
                        </p>
                      )}
                      <Collapsible>
                        <DetailsToggle>{t.references}</DetailsToggle>
                        <CollapsibleContent>
                          <pre className="mt-2 max-h-64 max-w-md overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">
                            {JSON.stringify(
                              {
                                eventId: entry.id,
                                actorId: entry.actorId,
                                objectType: entry.objectType,
                                objectId: entry.objectId,
                                requestId: entry.requestId,
                                action: entry.action,
                                changes: entry.changes,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </CollapsibleContent>
                      </Collapsible>
                    </CollapsibleContent>
                  </Collapsible>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!entries.length ? <EmptyState icon={ScrollText} title={t.empty} /> : null}
        {footer}
      </Card>
      <p className="m-0 text-xs text-muted-foreground">{t.currentLabels}</p>
    </>
  );
}

function DetailsToggle({ children }: { children: ReactNode }) {
  return (
    <CollapsibleTrigger className="group/toggle flex cursor-pointer items-center gap-1 text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50">
      {children}
      <ChevronDown
        className="size-3.5 transition-transform group-data-[panel-open]/toggle:rotate-180"
        aria-hidden="true"
      />
    </CollapsibleTrigger>
  );
}
