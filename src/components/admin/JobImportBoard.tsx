"use client";

import { useRef, useState, type ChangeEvent } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  FileDown,
  FileSpreadsheet,
  FileUp,
  History,
  LoaderCircle,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { UpdatingStatus } from "./AdminQueryFeedback";
import { EmptyState } from "./ui/empty-state";
import { AdminPageHeader } from "./ui/page-header";
import { SectionCard } from "./ui/section-card";
import type { AdminLang } from "@/lib/admin/nav";
import { referenceQueryOptions } from "@/lib/admin/queries";
import { AdminRequestError } from "@/lib/admin/staffClient";
import { useAdminTimeZone } from "@/lib/admin/useAdminTimeZone";
import { AdminLink as Link } from "@/components/admin/AdminNavigation";
import {
  importColumnByKey,
  importLimits,
  type ImportColumnKey,
} from "@/lib/admin/jobImport/columns";
import type { SheetIssue } from "@/lib/admin/jobImport/parse";
import type {
  DuplicateChoice,
  ImportDecisions,
  ImportIssue,
  ImportRowInput,
  ImportRowResult,
} from "@/lib/admin/jobImport/validate";
import {
  commitImport,
  importHistoryQueryKey,
  importHistoryQueryOptions,
  ImportRejectedError,
  previewImport,
} from "@/lib/admin/jobImportClient";
import { fill, jobImportContent } from "@/lib/admin/jobImportContent";
import type { ImportCommitResult } from "../../server/jobs/import-contract";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type LoadedFile = {
  id: number;
  name: string;
  rows: ImportRowInput[];
  // Reused on every retry of this file, so a retried commit can never apply twice.
  batchId: string;
};
const tone = {
  ok: "accent",
  error: "rose",
  duplicate: "amber",
  skipped: "gray",
} as const;
let fileCounter = 0;

export function JobImportBoard({ lang }: { lang: AdminLang }) {
  const t = jobImportContent[lang];
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const { timeZone } = useAdminTimeZone();
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [sheetIssues, setSheetIssues] = useState<SheetIssue[]>([]);
  // Shown even when the file is rejected, so HR can see which columns need adjusting.
  const [notes, setNotes] = useState({
    unknownColumns: [] as string[],
    missingMarker: false,
  });
  const [decisions, setDecisions] = useState<ImportDecisions>({
    default: null,
    perRow: {},
  });
  const [reading, setReading] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState<ImportCommitResult | null>(null);

  const references = useQuery(referenceQueryOptions);
  const history = useQuery(importHistoryQueryOptions);
  const decisionsKey = JSON.stringify([
    decisions.default,
    Object.entries(decisions.perRow).sort(),
  ]);
  const preview = useQuery({
    queryKey: ["admin", "job-import-preview", file?.id ?? 0, decisionsKey],
    queryFn: ({ signal }) => previewImport(file!.rows, decisions, signal),
    enabled: !!file && sheetIssues.length === 0 && !done,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
  const result = preview.data;
  const checking = preview.isFetching;

  const commit = useMutation({
    mutationFn: () =>
      commitImport({
        requestId: file!.batchId,
        fileName: file!.name,
        rows: file!.rows,
        decisions,
        preview: result!,
      }),
    onSuccess: (data) => {
      setDone(data);
      setFile(null);
      setNotice(null);
      void client.invalidateQueries({ queryKey: importHistoryQueryKey });
    },
    onError: (error) => {
      if (error instanceof ImportRejectedError) {
        setNotice(t.rejected);
        void preview.refetch();
      } else if (error instanceof AdminRequestError && error.status === 409)
        setNotice(t.conflict);
      else if (error instanceof AdminRequestError && error.status === 403)
        setNotice(t.denied);
      else setNotice(t.failed);
      void client.invalidateQueries({ queryKey: importHistoryQueryKey });
    },
  });

  const reset = () => {
    setFile(null);
    setSheetIssues([]);
    setNotes({ unknownColumns: [], missingMarker: false });
    setDecisions({ default: null, perRow: {} });
    setNotice(null);
    commit.reset();
  };

  async function downloadTemplate() {
    if (!references.data) return;
    setTemplateBusy(true);
    setNotice(null);
    try {
      const [{ buildJobImportTemplate }, { triggerDownload }] =
        await Promise.all([
          import("@/lib/admin/jobImport/template"),
          import("@/lib/admin/exportFile"),
        ]);
      const buffer = await buildJobImportTemplate(references.data);
      triggerDownload(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        "job-import-template.xlsx",
      );
    } catch {
      setNotice(t.templateFailed);
    } finally {
      setTemplateBusy(false);
    }
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    reset();
    setDone(null);
    if (selected.size > importLimits.maxFileBytes) {
      setSheetIssues([{ code: "file_too_large" }]);
      return;
    }
    setReading(true);
    try {
      const { parseJobImportWorkbook } =
        await import("@/lib/admin/jobImport/parse");
      const parsed = await parseJobImportWorkbook(await selected.arrayBuffer());
      setSheetIssues(parsed.issues);
      setNotes({
        unknownColumns: parsed.unknownColumns,
        missingMarker: parsed.missingMarker,
      });
      if (!parsed.issues.length)
        setFile({
          id: ++fileCounter,
          name: selected.name,
          rows: parsed.rows,
          batchId: crypto.randomUUID(),
        });
    } catch {
      setSheetIssues([{ code: "not_xlsx" }]);
    } finally {
      setReading(false);
    }
  }

  const setChoice = (row: number, choice: DuplicateChoice | "") =>
    setDecisions((current) => {
      const perRow = { ...current.perRow };
      if (choice) perRow[row] = choice;
      else delete perRow[row];
      return { ...current, perRow };
    });
  const chooseAll = (choice: DuplicateChoice) =>
    setDecisions({ default: choice, perRow: {} });

  const columnName = (key: ImportColumnKey) =>
    importColumnByKey[key].label[lang];
  const issueText = (issue: ImportIssue) => {
    const message = fill(t.issues[issue.code], {
      row: fill(t.otherRow, { n: issue.otherRow ?? "" }),
    });
    return issue.column ? `${columnName(issue.column)} — ${message}` : message;
  };
  const sheetText = (issue: SheetIssue) =>
    fill(t.sheetIssues[issue.code], {
      columns: (issue.columns ?? []).map(columnName).join(", "),
    });
  const cellFor = (row: number, key: ImportColumnKey) =>
    file?.rows.find((r) => r.row === row)?.cells[key]?.trim() ?? "";

  const duplicateRows = result?.rows.filter((r) => r.duplicate) ?? [];
  const when = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const canConfirm =
    !!result?.canConfirm && !checking && !commit.isPending && !!file;
  const summary = result?.summary;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <AdminPageHeader
        title={t.title}
        description={t.intro}
        actions={
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={`/admin/jobs?lang=${lang}`}
          >
            <ArrowLeft aria-hidden="true" />
            {t.back}
          </Link>
        }
      />

      {notice ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {done ? (
        <SectionCard
          title={t.doneTitle}
          aria-live="polite"
          bodyClassName="flex flex-col gap-4"
        >
          <p className="m-0 flex items-center gap-2 text-sm">
            <CircleCheck className="size-4 text-tone-green-foreground" aria-hidden="true" />
            {fill(t.done, {
              created: done.created,
              overwritten: done.overwritten,
              skipped: done.skipped,
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link className={buttonVariants()} href={`/admin/jobs?lang=${lang}`}>
              {t.viewJobs}
            </Link>
            <Button variant="outline" onClick={() => setDone(null)}>
              {t.importAnother}
            </Button>
          </div>
        </SectionCard>
      ) : (
        <>
          <Card variant="panel" className="grid gap-6 p-5 md:grid-cols-2">
            <div className="flex flex-col items-start gap-3">
              <h2 className="m-0 text-[15px] font-semibold">
                {t.stepTemplate}
              </h2>
              <Button
                variant="outline"
                disabled={!references.data || templateBusy}
                onClick={downloadTemplate}
              >
                <FileDown aria-hidden="true" />
                {templateBusy ? t.preparingTemplate : t.downloadTemplate}
              </Button>
            </div>
            <div className="flex flex-col items-start gap-3">
              <h2 className="m-0 text-[15px] font-semibold">{t.stepUpload}</h2>
              <input
                ref={input}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                aria-label={t.chooseFile}
                onChange={readFile}
              />
              <Button
                disabled={reading || commit.isPending}
                onClick={() => input.current?.click()}
              >
                <FileUp aria-hidden="true" />
                {reading ? t.reading : file ? t.chooseAnother : t.chooseFile}
              </Button>
              {file ? (
                <p className="m-0 flex items-center gap-2 text-xs text-muted-foreground">
                  <FileSpreadsheet className="size-4" aria-hidden="true" />
                  {fill(t.fileSummary, {
                    name: file.name,
                    count: file.rows.length,
                  })}
                </p>
              ) : null}
            </div>
          </Card>

          {sheetIssues.length ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription className="flex flex-col gap-2">
                <strong>{t.fileProblem}</strong>
                <ul className="m-0 list-disc space-y-1 ps-5">
                  {sheetIssues.map((issue) => (
                    <li key={issue.code}>{sheetText(issue)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {notes.missingMarker && !sheetIssues.length ? (
            <p className="m-0 text-xs text-muted-foreground">
              {t.missingMarker}
            </p>
          ) : null}
          {notes.unknownColumns.length ? (
            <p className="m-0 text-xs text-muted-foreground">
              {t.unknownColumns} {notes.unknownColumns.join(", ")}
            </p>
          ) : null}

          {file ? (
            <SectionCard
              title={t.stepPreview}
              padded={false}
              bodyClassName="flex flex-col"
            >
              {preview.isError && !result ? (
                <Alert variant="destructive" className="m-5 w-auto">
                  <CircleAlert aria-hidden="true" />
                  <AlertDescription>{t.previewFailed}</AlertDescription>
                </Alert>
              ) : null}
              {checking ? (
                <div className="px-5 pt-4">
                  <UpdatingStatus>{t.checking}</UpdatingStatus>
                </div>
              ) : null}

              {result && duplicateRows.length ? (
                <div className="m-5 flex flex-col gap-3 rounded-lg bg-tone-amber p-4 text-tone-amber-foreground">
                  <h3 className="m-0 text-sm font-semibold">
                    {t.duplicatesTitle}
                  </h3>
                  <p className="m-0 text-[13px]">
                    {fill(t.duplicatesBody, { count: duplicateRows.length })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => chooseAll("skip")}
                    >
                      {t.skipAll}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => chooseAll("overwrite")}
                    >
                      {t.overwriteAll}
                    </Button>
                  </div>
                </div>
              ) : null}

              {result ? (
                <div aria-busy={checking}>
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.columns.row}</TableHead>
                        <TableHead>{t.columns.job}</TableHead>
                        <TableHead>{t.columns.project}</TableHead>
                        <TableHead>{t.columns.status}</TableHead>
                        <TableHead>{t.columns.details}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.rows.map((row: ImportRowResult) => (
                        <TableRow
                          key={row.row}
                          data-import-state={row.status}
                          className="align-top"
                        >
                          <TableCell className="font-medium tabular-nums">
                            {row.row}
                          </TableCell>
                          <TableCell>
                            {cellFor(row.row, "title_zh") || t.emptyColumn}
                          </TableCell>
                          <TableCell>
                            {cellFor(row.row, "project") || t.emptyColumn}
                          </TableCell>
                          <TableCell>
                            <Badge tone={tone[row.status]}>
                              {t.status[row.status]}
                            </Badge>
                            {row.action ? (
                              <small className="mt-1 block text-xs text-muted-foreground">
                                {t.action[row.action]}
                              </small>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {row.issues.length ? (
                              <ul className="m-0 list-disc space-y-1 ps-4 text-xs text-destructive">
                                {row.issues.map((issue, index) => (
                                  <li key={index}>{issueText(issue)}</li>
                                ))}
                              </ul>
                            ) : null}
                            {row.duplicate &&
                            !row.issues.some(
                              (i) => i.code === "ambiguous_duplicate",
                            ) ? (
                              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                                <span>{t.existingJob}</span>
                                <NativeSelect
                                  size="sm"
                                  value={
                                    decisions.perRow[row.row] ??
                                    decisions.default ??
                                    ""
                                  }
                                  onChange={(event) =>
                                    setChoice(
                                      row.row,
                                      event.target.value as
                                        DuplicateChoice | "",
                                    )
                                  }
                                >
                                  <NativeSelectOption value="">
                                    {t.choose}
                                  </NativeSelectOption>
                                  <NativeSelectOption value="skip">
                                    {t.skip}
                                  </NativeSelectOption>
                                  <NativeSelectOption value="overwrite">
                                    {t.overwrite}
                                  </NativeSelectOption>
                                </NativeSelect>
                              </label>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 border-t border-border p-5">
                {summary ? (
                  <p className="m-0 text-sm font-medium" aria-live="polite">
                    {fill(t.summary, {
                      create: summary.create,
                      overwrite: summary.overwrite,
                      skipped: summary.skipped,
                      errors: summary.errors + summary.undecided,
                    })}
                  </p>
                ) : null}
                {result && !result.canConfirm ? (
                  <p className="m-0 text-xs text-muted-foreground">
                    {t.cantConfirm}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!canConfirm} onClick={() => commit.mutate()}>
                    {commit.isPending ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    ) : null}
                    {commit.isPending ? t.importing : t.confirm}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={commit.isPending}
                    onClick={reset}
                  >
                    {t.cancel}
                  </Button>
                </div>
              </div>
            </SectionCard>
          ) : null}
        </>
      )}

      <SectionCard title={t.historyTitle} padded={false}>
        {history.data?.imports.length ? (
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t.historyColumns.when}</TableHead>
                <TableHead>{t.historyColumns.who}</TableHead>
                <TableHead>{t.historyColumns.file}</TableHead>
                <TableHead>{t.historyColumns.result}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.data.imports.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{when.format(new Date(entry.createdAt))}</TableCell>
                  <TableCell>{entry.actorName ?? t.unknownActor}</TableCell>
                  <TableCell>{entry.fileName}</TableCell>
                  <TableCell>
                    {entry.status === "FAILED"
                      ? fill(t.failedImport, { failed: entry.failed })
                      : fill(t.historyResult, {
                          created: entry.created,
                          overwritten: entry.overwritten,
                          skipped: entry.skipped,
                        })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : history.isSuccess ? (
          <EmptyState icon={History} title={t.historyEmpty} />
        ) : null}
      </SectionCard>
    </div>
  );
}
