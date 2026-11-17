"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AdminLang } from "@/lib/admin/nav";
import { jobsQueryOptions, referenceQueryOptions } from "@/lib/admin/queries";
import { useAdminLoading } from "./AdminNavigation";
import { Bone, TableRowsSkeleton } from "./ui/data-skeleton";
import { AdminRefreshButton } from "./AdminRefreshButton";
import {
  AdminQueryFeedback,
  useAdminQuerySnapshot,
} from "./AdminQueryFeedback";
import { AdminPagination } from "./AdminPagination";
import { AdminSelectCheckbox } from "./AdminSelectCheckbox";
import { BulkActionBar, BulkConfirmDialog } from "./BulkActionBar";
import { useRowSelection } from "@/lib/admin/useRowSelection";
import { tableContent } from "@/lib/admin/tableContent";
import {
  bulkJobEligible,
  jobBulkContent,
  type BulkJobAction,
} from "@/lib/admin/jobBulkContent";
import { sendJobCommand } from "@/lib/admin/jobClient";
import { AdminRequestError, signInAgain } from "@/lib/admin/staffClient";
import { InstantFilterForm } from "@/components/admin/InstantFilterForm";
import {
  AdminLink as Link,
  useAdminRouter as useRouter,
} from "@/components/admin/AdminNavigation";
import { parseJobQuery } from "@/lib/admin/jobListQuery";
import { jobManagementContent } from "@/lib/admin/jobManagementContent";
import { hasEnglish, isPastDeadline, jobLabel } from "@/lib/admin/jobFields";
import { jobsContent } from "@/lib/admin/jobsContent";
import { jobStatusOrder, jobStatusTone } from "@/lib/admin/jobStatus";
import { Pencil, Plus, SearchX, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AdminPageHeader } from "@/components/admin/ui/page-header";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { EmptyValue } from "@/components/admin/ui/empty-value";
import {
  PillCount,
  SearchField,
  filterPillClass,
} from "@/components/admin/ui/filter-controls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Props = { lang: AdminLang; canEdit: boolean };

export function JobsBoard({ lang, canEdit }: Props) {
  const search = useSearchParams();
  const router = useRouter();
  const parsed = useMemo(() => {
    try {
      return {
        filters: parseJobQuery(new URLSearchParams(search.toString())),
        valid: true,
      };
    } catch {
      return { filters: parseJobQuery(new URLSearchParams()), valid: false };
    }
  }, [search]);
  const filters = parsed.filters;
  const listing = useQuery({
    ...jobsQueryOptions(filters),
    enabled: parsed.valid,
    placeholderData: keepPreviousData,
  });
  const references = useQuery({
    ...referenceQueryOptions,
    enabled: parsed.valid,
  });
  const snapshot = useAdminQuerySnapshot(
    listing.data,
    listing.isPlaceholderData,
    listing.error,
  );
  const [searchInput, setSearchInput] = useState({
    url: filters.q,
    value: filters.q,
  });
  if (searchInput.url !== filters.q)
    setSearchInput({ url: filters.q, value: filters.q });
  useAdminLoading(
    parsed.valid && listing.isFetching && listing.isPlaceholderData,
  );
  const [bulkAction, setBulkAction] = useState<BulkJobAction | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const pageJobs = snapshot?.page.jobs;
  const jobIds = useMemo(
    () => pageJobs?.map((job) => job.id) ?? [],
    [pageJobs],
  );
  // Selection belongs to the visible page; any filter or paging change drops it.
  const selection = useRowSelection(
    jobIds,
    `${filters.q}|${filters.statuses.join(",")}|${filters.page}|${filters.pageSize}`,
  );
  const t = jobsContent[lang];
  const m = jobManagementContent[lang];
  const retry = () => {
    void listing.refetch();
    void references.refetch();
  };
  if (!parsed.valid) return <p role="alert">{m.failed}</p>;
  if (!snapshot || !references.data) {
    if (listing.isError || references.isError)
      return (
        <AdminQueryFeedback lang={lang} error hasData={false} retry={retry} />
      );
  }
  // Until data arrives the page keeps its real title, buttons, status tabs,
  // search box and column headers; only counts and rows are placeholders.
  const settings = references.data;
  const loading = !snapshot || !settings;
  const { jobs, total, page, pageSize, statusCounts } = snapshot?.page ?? {
    jobs: [],
    total: 0,
    page: filters.page,
    pageSize: filters.pageSize,
    statusCounts: {} as Record<string, number>,
  };
  const href = (
    statuses: typeof filters.statuses,
    nextPage = 1,
    nextPageSize = filters.pageSize,
  ) => {
    const value = new URLSearchParams({
      lang,
      q: filters.q,
      page: String(nextPage),
      pageSize: String(nextPageSize),
    });
    statuses.forEach((s) => value.append("status", s));
    return `/admin/jobs?${value}`;
  };
  const langQuery = `lang=${lang}`;
  const tt = tableContent[lang];
  const bulk = jobBulkContent[lang];
  const selectedJobs = jobs.filter((job) => selection.isSelected(job.id));
  const eligibleFor = (action: BulkJobAction) =>
    selectedJobs.filter((job) => bulkJobEligible(job.status, action));

  // Applies one action to each eligible selected job in turn. Each job carries
  // its own version, so a job edited elsewhere fails alone instead of being overwritten.
  async function runBulk(action: BulkJobAction) {
    const targets = eligibleFor(action);
    setBulkPending(true);
    let ok = 0;
    for (const job of targets) {
      try {
        let version = job.version;
        if (action === "publish" && job.status === "draft") {
          version = (
            await sendJobCommand(`/api/admin/jobs/${job.id}/actions`, "POST", {
              requestId: crypto.randomUUID(),
              expectedVersion: version,
              action: "submit",
            })
          ).version;
        }
        await sendJobCommand(`/api/admin/jobs/${job.id}/actions`, "POST", {
          requestId: crypto.randomUUID(),
          expectedVersion: version,
          action,
        });
        ok++;
      } catch (cause) {
        if (cause instanceof AdminRequestError && cause.status === 401) {
          signInAgain(lang);
          return;
        }
      }
    }
    const failed = targets.length - ok;
    if (!failed) toast.success(bulk.done(ok));
    else if (ok) toast.error(bulk.partial(ok, failed));
    else toast.error(bulk.failed);
    setBulkPending(false);
    setBulkAction(null);
    selection.clear();
    void listing.refetch();
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <AdminPageHeader
        title={t.title}
        actions={
          <>
            <AdminRefreshButton
              label={lang === "en" ? "Refresh" : "\u5237\u65b0"}
              refreshing={listing.isFetching || references.isFetching}
              onRefresh={() =>
                Promise.all([listing.refetch(), references.refetch()])
              }
            />
            {canEdit ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`/admin/jobs/import?${langQuery}`}
              >
                <Upload aria-hidden="true" />
                {m.importJobs}
              </Link>
            ) : null}
            {canEdit ? (
              <Link
                className={buttonVariants()}
                href={`/admin/jobs/new?${langQuery}`}
              >
                <Plus aria-hidden="true" />
                {t.newJob}
              </Link>
            ) : null}
          </>
        }
      />

      <AdminQueryFeedback
        lang={lang}
        error={listing.isError || references.isError}
        retry={retry}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            queryNavigation
            href={href([])}
            aria-current={filters.statuses.length === 0 ? "true" : undefined}
            className={filterPillClass(filters.statuses.length === 0)}
          >
            {t.all}
            <PillCount>
              {loading ? (
                <Bone width={18} height={11} />
              ) : (
                Object.values(statusCounts).reduce((a, b) => a + b, 0)
              )}
            </PillCount>
          </Link>
          {jobStatusOrder.map((value) => (
            <Link
              key={value}
              queryNavigation
              href={href(
                filters.statuses.includes(value)
                  ? filters.statuses.filter((s) => s !== value)
                  : [...filters.statuses, value],
              )}
              aria-current={
                filters.statuses.includes(value) ? "true" : undefined
              }
              className={filterPillClass(filters.statuses.includes(value))}
            >
              {jobStatusTone[value].label[lang]}
              <PillCount>
                {loading ? (
                  <Bone width={18} height={11} />
                ) : (
                  (statusCounts[value] ?? 0)
                )}
              </PillCount>
            </Link>
          ))}
        </div>
        <InstantFilterForm
          className="w-full sm:w-auto"
          onApply={(href) => window.history.replaceState(null, "", href)}
          action="/admin/jobs"
          lang={lang}
        >
          <input type="hidden" name="lang" value={lang} />
          {filters.statuses.map((status) => (
            <input key={status} type="hidden" name="status" value={status} />
          ))}
          <input type="hidden" name="pageSize" value={filters.pageSize} />
          <SearchField
            aria-label={t.searchPlaceholder}
            name="q"
            value={searchInput.value}
            onChange={(event) =>
              setSearchInput({ url: filters.q, value: event.target.value })
            }
            placeholder={t.searchPlaceholder}
          />
        </InstantFilterForm>
      </div>

      <Card
        variant="panel"
        className="overflow-hidden transition-opacity duration-150 aria-busy:opacity-60"
        aria-busy={listing.isFetching && listing.isPlaceholderData}
      >
        {canEdit ? (
          <BulkActionBar
            lang={lang}
            count={selection.count}
            busy={bulkPending}
            onClear={selection.clear}
          >
            {(["publish", "pause", "resume", "close"] as const).map((action) =>
              eligibleFor(action).length ? (
                <Button
                  key={action}
                  variant="outline"
                  size="sm"
                  disabled={bulkPending}
                  onClick={() => setBulkAction(action)}
                >
                  {bulk.actions[action]} ({eligibleFor(action).length})
                </Button>
              ) : null,
            )}
          </BulkActionBar>
        ) : null}
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableRow>
              {canEdit ? (
                <TableHead>
                  <AdminSelectCheckbox
                    label={tt.selectAll}
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    disabled={jobs.length === 0}
                    onChange={selection.toggleAll}
                  />
                </TableHead>
              ) : null}
              <TableHead>{t.columns.job}</TableHead>
              <TableHead>{t.columns.department}</TableHead>
              <TableHead>{t.columns.location}</TableHead>
              <TableHead>{t.columns.status}</TableHead>
              <TableHead>{t.columns.site}</TableHead>
              <TableHead>{t.columns.closes}</TableHead>
              <TableHead>{t.columns.applications}</TableHead>
              <TableHead className="text-right">{t.columns.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!settings ? (
              <TableRowsSkeleton
                columns={canEdit ? 8 : 7}
                leading={canEdit}
                trailingRight
              />
            ) : null}
            {settings &&
              jobs.map((job) => {
                const tone = jobStatusTone[job.status];
                const expired =
                  job.status === "published" && isPastDeadline(job);
                const live =
                  job.live ?? (job.status === "published" && !expired);
                const english = hasEnglish(job);
                const label = jobLabel(job, settings, lang);
                // Prefer the console language and flag unavailable English content.
                // Existing Chinese-only jobs remain identifiable without inventing translations.
                const title =
                  job.title[lang].trim() || job.title.zh || job.title.en;
                return (
                  <TableRow
                    key={job.id}
                    className="cursor-pointer"
                    data-selected={selection.isSelected(job.id)}
                    onClick={() =>
                      router.push(`/admin/jobs/${job.id}/edit?${langQuery}`)
                    }
                  >
                    {canEdit ? (
                      <TableCell>
                        <AdminSelectCheckbox
                          label={`${tt.selectRow}: ${title || job.id}`}
                          checked={selection.isSelected(job.id)}
                          onChange={() => selection.toggle(job.id)}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <span className="block text-sm font-medium text-foreground">
                        {title || <EmptyValue />}
                      </span>
                      <span
                        className={cn(
                          "mt-1 block text-xs text-muted-foreground",
                          !english && "text-destructive",
                        )}
                      >
                        J-{job.id}
                        {!english ? ` \u00b7 ${t.missingEnglish}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>{label.department}</TableCell>
                    <TableCell>{label.location}</TableCell>
                    <TableCell>
                      <Badge tone={tone.tone}>{tone.label[lang]}</Badge>
                      {job.hasUnpublishedChanges ? (
                        <small className="mt-1 block text-xs text-muted-foreground">
                          {m.unpublished}
                        </small>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap">
                        <span
                          className={cn(
                            "size-1.5 rounded-full bg-muted-foreground/40",
                            live && "bg-primary",
                          )}
                          aria-hidden="true"
                        />
                        {live ? t.live : t.offline}
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-xs whitespace-nowrap tabular-nums",
                        expired && "text-destructive",
                      )}
                    >
                      {job.closesAt ? (
                        job.closesAt.slice(5).replace("-", ".")
                      ) : (
                        <EmptyValue />
                      )}
                      {expired ? ` ${t.expired}` : ""}
                    </TableCell>
                    <TableCell className="font-medium tabular-nums">
                      {job.applications ?? <EmptyValue />}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/admin/jobs/${job.id}/edit?${langQuery}`}
                        onClick={(event) => event.stopPropagation()}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "sm",
                        })}
                      >
                        <Pencil aria-hidden="true" />
                        {t.edit}
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
        {!loading && jobs.length === 0 ? (
          <EmptyState icon={SearchX} title={t.noResults} />
        ) : null}
        {loading ? (
          <div className="flex items-center justify-between gap-4 px-5 py-3">
            <Bone width={120} height={12} />
            <Bone width={140} height={32} />
          </div>
        ) : (
          <AdminPagination
            lang={lang}
            page={page}
            pageSize={pageSize}
            rowCount={jobs.length}
            total={total}
            busy={listing.isFetching && listing.isPlaceholderData}
            onPageChange={(next) =>
              window.history.pushState(null, "", href(filters.statuses, next))
            }
            onPageSizeChange={(size) =>
              window.history.pushState(
                null,
                "",
                href(filters.statuses, 1, size),
              )
            }
          />
        )}
      </Card>

      <BulkConfirmDialog
        lang={lang}
        open={bulkAction !== null}
        title={
          bulkAction
            ? bulk.confirmTitle(bulkAction, eligibleFor(bulkAction).length)
            : ""
        }
        description={
          bulkAction
            ? bulk.confirmBody[bulkAction] +
              (selectedJobs.length > eligibleFor(bulkAction).length
                ? bulk.skipped(
                    selectedJobs.length - eligibleFor(bulkAction).length,
                  )
                : "")
            : ""
        }
        confirmLabel={bulkAction ? bulk.actions[bulkAction] : ""}
        destructive={bulkAction === "close"}
        pending={bulkPending}
        onConfirm={() => bulkAction && void runBulk(bulkAction)}
        onCancel={() => setBulkAction(null)}
      />
    </div>
  );
}
