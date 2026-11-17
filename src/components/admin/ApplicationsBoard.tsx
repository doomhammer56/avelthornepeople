"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  applicationJobOptionsQuery,
  applicationQueryOptions,
} from "@/lib/admin/queries";
import { Bone, TableRowsSkeleton } from "./ui/data-skeleton";
import type { ApplicationPage } from "@/server/applications/service";
import { useAdminQuerySnapshot } from "./AdminQueryFeedback";
import {
  useAdminRouter as useRouter,
  AdminLink as Link,
} from "./AdminNavigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FilterX,
  Inbox,
  Search,
  TriangleAlert,
  User,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { EmptyState } from "./ui/empty-state";
import { EmptyValue } from "./ui/empty-value";
import { FormField } from "./ui/form-field";
import { SearchSelect } from "./ui/search-select";
import { AdminPagination } from "./AdminPagination";
import { AdminSelectCheckbox } from "./AdminSelectCheckbox";
import { BulkActionBar, BulkConfirmDialog } from "./BulkActionBar";
import { useRowSelection } from "@/lib/admin/useRowSelection";
import { tableContent } from "@/lib/admin/tableContent";
import {
  applicationBulkContent,
  type BulkApplicationStage,
} from "@/lib/admin/applicationBulkContent";
import { AdminRequestError, signInAgain } from "@/lib/admin/staffClient";
import { useAdminTimeZone } from "@/lib/admin/useAdminTimeZone";
import { applicationExport } from "@/lib/admin/applicationExport";
import { toast } from "sonner";
import {
  applicationStatusTone,
  type ApplicationStatus,
} from "@/lib/admin/applicationStatus";
import { applicationsContent } from "@/lib/admin/applicationsContent";
import type { AdminLang } from "@/lib/admin/nav";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApplicationRowActions } from "./ApplicationRowActions";
import { ExportMenu } from "./ExportMenu";
import {
  recruitmentContent,
  recruitmentRequest,
  applicationListHref,
} from "@/lib/admin/recruitmentClient";
import { stageLabels, type RecruitmentStage } from "@/lib/admin/recruitment";
import type { ApplicationQuery } from "@/server/applications/contract";
import type { ContactSearch } from "@/lib/admin/applicationFilters";
import { instantFilterText } from "@/lib/admin/instantFilters";

type Props = {
  query: ApplicationQuery;
  lang: AdminLang;
  canEdit: boolean;
};

const stages: ApplicationStatus[] = [
  "New",
  "Screening",
  "Interview",
  "Offer",
  "Rejected",
];

// Pipeline + table for A04. Selecting a row now opens its own detail page
// (admin/applications/[id]) instead of a side panel sharing this screen —
// the table gets the full width, and the detail view gets its own. Bulk
// import lives on the Jobs screen instead (importing job postings, not
// candidate applications, is the actual HR workflow here).
export function ApplicationsBoard({ query, lang, canEdit }: Props) {
  const t = applicationsContent[lang];
  const router = useRouter();
  const { timeZone } = useAdminTimeZone();
  const dateFormat = new Intl.DateTimeFormat(
    lang === "zh" ? "zh-CN" : "en-GB",
    { dateStyle: "medium", timeZone },
  );
  const timeFormat = new Intl.DateTimeFormat(
    lang === "zh" ? "zh-CN" : "en-GB",
    { timeStyle: "short", timeZone },
  );
  const client = useQueryClient();
  const searchId = useId();
  const [privateSearchSequence, setPrivateSearchSequence] = useState(0);
  const [contact, setContact] = useState<ContactSearch>({
    email: "",
    phone: "",
    region: "",
  });
  const [criteria, setCriteria] = useState(query);
  const [searchReady, setSearchReady] = useState(true);
  const criteriaRef = useRef(query);
  const contactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const contactSequence = useRef(0);
  const [contactError, setContactError] = useState(false);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [jobSearch, setJobSearch] = useState("");
  const [jobFilter, setJobFilter] = useState("");
  const [jobPage, setJobPage] = useState(1);
  const [contactOpen, setContactOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setJobFilter(jobSearch);
      setJobPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [jobSearch]);
  const options = useQuery({
    ...applicationJobOptionsQuery(jobFilter, jobPage, criteria.jobId),
    placeholderData: keepPreviousData,
  });
  const queryOptions = applicationQueryOptions(
    criteria,
    `${searchId}:${privateSearchSequence}`,
  );
  const listing = useQuery({
    ...queryOptions,
    enabled: searchReady,
    placeholderData: keepPreviousData,
  });
  const displayed = useAdminQuerySnapshot(
    listing.data,
    listing.isPlaceholderData,
    listing.error,
  );
  // Busy only while the list reloads for a changed filter or page (the old rows
  // are kept on screen as placeholders). Quiet background refreshes, such as
  // returning to the tab, must not dim or disable the page.
  const busy = listing.isFetching && listing.isPlaceholderData;
  const [bulkStage, setBulkStage] = useState<BulkApplicationStage | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const pageApplications = displayed?.page.applications;
  const applicationIds = useMemo(
    () => pageApplications?.map((app) => app.id) ?? [],
    [pageApplications],
  );
  // Selection belongs to the visible page; filters and paging always drop it.
  const selection = useRowSelection(
    applicationIds,
    JSON.stringify(displayed?.criteria ?? criteria),
  );
  const r = recruitmentContent[lang];
  const error = listing.isError || contactError ? r.failed : "";

  useEffect(
    () => () => {
      if (contactTimer.current) clearTimeout(contactTimer.current);
      contactSequence.current++;
    },
    [],
  );
  useEffect(() => {
    if (!listing.data || listing.isPlaceholderData) return;
    window.history.replaceState(
      null,
      "",
      applicationListHref(listing.data.criteria, lang),
    );
  }, [listing.data, listing.isPlaceholderData, lang]);

  function load(next: ApplicationQuery) {
    if (contactTimer.current) clearTimeout(contactTimer.current);
    criteriaRef.current = next;
    setCriteria(next);
    setSearchReady(true);
    // Contact lookups are ephemeral: no raw contact terms in cache keys or URLs.
    if (next.email || next.phone)
      setPrivateSearchSequence((value) => value + 1);
  }

  // Merge every filter against the latest selections rather than an older render.
  // Email and phone are deliberately excluded from the shareable listing URL.
  async function navigate(next: ApplicationQuery, terms = contact) {
    const sequence = ++contactSequence.current;
    setContactError(false);
    if (!terms.email && !terms.phone && !terms.region) {
      load({ ...next, email: undefined, phone: undefined, region: undefined });
      return;
    }
    try {
      const { completeContactFilters } =
        await import("@/lib/admin/applicationFilters");
      if (sequence !== contactSequence.current) return;
      const values = completeContactFilters(terms);
      if (values) load({ ...next, ...values });
    } catch {
      if (sequence === contactSequence.current) setContactError(true);
    }
  }

  // Debounce exact contact searches until typing and text composition are complete.
  // Incomplete email addresses and phone numbers never trigger failed backend lookups.
  function changeContact(next: ContactSearch) {
    contactSequence.current++;
    setContact(next);
    if (contactTimer.current) clearTimeout(contactTimer.current);
    setSearchReady(false);
    void client.cancelQueries({ queryKey: queryOptions.queryKey, exact: true });
    if (composing.current) return;
    contactTimer.current = setTimeout(
      () => navigate({ ...criteriaRef.current, page: 1 }, next),
      500,
    );
  }

  // Apply dropdowns immediately while preserving any completed private contact search.
  // Changing criteria always starts at page one of the backend-filtered collection.
  function changeCriteria(change: Partial<ApplicationQuery>) {
    const next = { ...criteriaRef.current, ...change, page: 1 };
    criteriaRef.current = next;
    setCriteria(next);
    navigate(next);
  }
  if (!displayed) {
    if (listing.isError)
      return (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{r.failed}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void listing.refetch()}
            >
              {lang === "zh" ? "重试" : "Retry"}
            </Button>
          </AlertDescription>
        </Alert>
      );
  }
  // First load: filters, stage names, column headers and toolbar are real;
  // only counts and rows are placeholders until the list arrives.
  const loading = !displayed;
  const result: ApplicationPage = displayed?.page ?? {
    applications: [],
    total: 0,
    page: criteria.page,
    pageSize: criteria.pageSize,
    counts: { NEW: 0, SCREENING: 0, INTERVIEW: 0, OFFER: 0, REJECTED: 0 },
  };
  const activeQuery = displayed?.criteria ?? criteria;
  const visible = result.applications;
  const jobs = options.data ?? [];
  const jobTitles = Object.fromEntries(
    visible.map((app) => [
      app.jobId,
      app.jobTitle[lang] || app.jobTitle.zh || app.jobId,
    ]),
  );
  const langQuery = `lang=${lang}`;
  const contactActive = !!(contact.email || contact.phone || contact.region);
  const filtersActive =
    !!criteria.jobId ||
    !!criteria.source ||
    criteria.status.length > 0 ||
    contactActive;
  // Export only the last completed page, with its actual filters and display timezone.
  // Private contact criteria are described as active without repeating their values in report metadata.
  const stageSummary =
    activeQuery.status
      .map((code) => applicationStatusTone[stageLabels[code]].label[lang])
      .join(", ") || t.allStages;
  const selectedJob = jobs.find((job) => job.id === activeQuery.jobId);
  const exportSummary = [
    `${t.columns.job}: ${selectedJob ? selectedJob[lang] || selectedJob.zh : t.allJobs}`,
    `${t.columns.source}: ${activeQuery.source ? t.sources[activeQuery.source] : lang === "en" ? "All sources" : "全部来源"}`,
    `${t.columns.status}: ${stageSummary}`,
    ...(activeQuery.email || activeQuery.phone ? [t.contactSearch] : []),
  ];
  const {
    headers: exportHeaders,
    rows: exportRows,
    report,
  } = applicationExport(visible, lang, timeZone, exportSummary);
  const selectedApplications = visible.filter((app) =>
    selection.isSelected(app.id),
  );
  const selectedExport = applicationExport(
    selectedApplications,
    lang,
    timeZone,
    exportSummary,
  );
  const tt = tableContent[lang];
  const bulk = applicationBulkContent[lang];
  const bulkTargets = (stage: BulkApplicationStage) =>
    selectedApplications.filter((app) => app.status !== stageLabels[stage]);

  // Moves each selected application in turn. Every application carries its own
  // version, so one changed elsewhere fails alone instead of being overwritten.
  async function runBulk(stage: BulkApplicationStage) {
    const targets = bulkTargets(stage);
    setBulkPending(true);
    let ok = 0;
    for (const app of targets) {
      try {
        await recruitmentRequest(`/api/admin/applications/${app.id}`, "PATCH", {
          status: stage,
          expectedVersion: app.version,
          requestId: crypto.randomUUID(),
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
    setBulkStage(null);
    selection.clear();
    void listing.refetch();
  }

  // Reset public criteria and private contact terms in one backend request.
  // Clearing filters must not leave a hidden email or phone constraint on the result list.
  function resetFilters() {
    const cleared = { email: "", phone: "", region: "" };
    setContact(cleared);
    navigate(
      { page: 1, pageSize: criteriaRef.current.pageSize, status: [] },
      cleared,
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {options.isError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>
              {lang === "zh"
                ? "职位筛选暂不可用。"
                : "Job filters are temporarily unavailable."}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void options.refetch()}
            >
              {lang === "zh" ? "重试" : "Retry"}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <Card
        variant="panel"
        className="gap-0 overflow-hidden"
        aria-label={t.filter}
      >
        <Collapsible open={contactOpen} onOpenChange={setContactOpen}>
          <form
            className="instant-filter-form flex flex-wrap items-end gap-3 p-4"
            action="/admin/applications"
            method="get"
            data-enhanced={hydrated}
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ ...criteriaRef.current, page: 1 });
            }}
          >
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="pageSize" value={query.pageSize} />
            <input type="hidden" name="jobId" value={criteria.jobId ?? ""} />
            {criteria.status.map((status) => (
              <input key={status} type="hidden" name="status" value={status} />
            ))}
            {(["candidateId", "from", "to"] as const).map((field) =>
              criteria[field] ? (
                <input
                  key={field}
                  type="hidden"
                  name={field}
                  value={criteria[field]}
                />
              ) : null,
            )}
            <FormField
              label={t.columns.job}
              htmlFor={`${searchId}-job`}
              className="min-w-56 flex-[2_1_18rem]"
            >
              <SearchSelect
                id={`${searchId}-job`}
                ariaLabel={t.columns.job}
                value={criteria.jobId ?? ""}
                onChange={(value) =>
                  changeCriteria({ jobId: value || undefined })
                }
                options={jobs.map((job) => ({
                  value: job.id,
                  label: job[lang] || job.zh || job.id,
                }))}
                allLabel={t.allJobs}
                search={jobSearch}
                onSearchChange={setJobSearch}
                searchPlaceholder={lang === "en" ? "Find a job…" : "搜索职位…"}
                emptyLabel={lang === "en" ? "No jobs found" : "未找到职位"}
                footer={
                  jobPage > 1 || jobs.length >= 100 ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={jobPage <= 1}
                        onClick={() => setJobPage((page) => page - 1)}
                      >
                        <ChevronLeft aria-hidden="true" />
                        {r.previous}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={jobs.length < 100}
                        onClick={() => setJobPage((page) => page + 1)}
                      >
                        {r.next}
                        <ChevronRight aria-hidden="true" />
                      </Button>
                    </>
                  ) : null
                }
              />
            </FormField>
            <FormField
              label={t.columns.source}
              htmlFor={`${searchId}-source`}
              className="min-w-44 flex-[1_1_12rem]"
            >
              <NativeSelect
                className="w-full"
                id={`${searchId}-source`}
                name="source"
                aria-label={t.columns.source}
                value={criteria.source ?? ""}
                onChange={(event) =>
                  changeCriteria({
                    source:
                      (event.target.value as ApplicationQuery["source"]) ||
                      undefined,
                  })
                }
              >
                <NativeSelectOption value="">
                  {lang === "en" ? "All sources" : "全部来源"}
                </NativeSelectOption>
                {Object.entries(t.sources).map(([key, label]) => (
                  <NativeSelectOption key={key} value={key}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={contactOpen || contactActive ? "secondary" : "outline"}
                aria-expanded={contactOpen}
                onClick={() => setContactOpen((open) => !open)}
              >
                <Search aria-hidden="true" />
                {t.contactSearch}
                {contactActive ? (
                  <span
                    className="size-1.5 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                ) : null}
                <ChevronDown
                  className={cn(
                    "transition-transform",
                    contactOpen && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </Button>
              <Button type="submit" variant="outline" data-filter-submit>
                {r.filters}
              </Button>
              {filtersActive ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={resetFilters}
                >
                  <FilterX aria-hidden="true" />
                  {t.clearFilters}
                </Button>
              ) : null}
            </div>
          </form>
          <CollapsibleContent>
            <div className="border-t border-border bg-muted/40 p-4">
              <p className="m-0 mb-3 max-w-3xl text-xs text-muted-foreground">
                {t.contactHelp}
              </p>
              <form
                className="instant-filter-form grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(100px,0.5fr)_auto_auto]"
                data-enhanced={hydrated}
                aria-busy={busy}
                onSubmit={(event) => {
                  event.preventDefault();
                  navigate({ ...criteriaRef.current, page: 1 });
                }}
                onCompositionStart={() => {
                  composing.current = true;
                  if (contactTimer.current) clearTimeout(contactTimer.current);
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                  changeContact(contact);
                }}
              >
                <FormField label={r.email} htmlFor={`${searchId}-email`}>
                  <Input
                    id={`${searchId}-email`}
                    aria-label={r.email}
                    placeholder={r.email}
                    type="email"
                    maxLength={254}
                    disabled={!hydrated}
                    value={contact.email}
                    onChange={(event) =>
                      changeContact({ ...contact, email: event.target.value })
                    }
                  />
                </FormField>
                <FormField label={r.phone} htmlFor={`${searchId}-phone`}>
                  <Input
                    id={`${searchId}-phone`}
                    aria-label={r.phone}
                    placeholder={r.phone}
                    type="tel"
                    maxLength={40}
                    disabled={!hydrated}
                    value={contact.phone}
                    onChange={(event) =>
                      changeContact({ ...contact, phone: event.target.value })
                    }
                  />
                </FormField>
                <FormField
                  label={t.countryLabel}
                  htmlFor={`${searchId}-region`}
                >
                  <Input
                    id={`${searchId}-region`}
                    aria-label={r.region}
                    placeholder={r.region}
                    maxLength={2}
                    disabled={!hydrated}
                    value={contact.region}
                    onChange={(event) =>
                      changeContact({ ...contact, region: event.target.value })
                    }
                  />
                </FormField>
                <Button
                  type="submit"
                  disabled={!hydrated || busy}
                  data-filter-submit
                >
                  {r.search}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const cleared = { email: "", phone: "", region: "" };
                    setContact(cleared);
                    navigate({ ...criteriaRef.current, page: 1 }, cleared);
                  }}
                >
                  {r.clear}
                </Button>
              </form>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>
      {/* Announced to screen readers only; sighted users see the list fade. */}
      {busy && (
        <span role="status" className="sr-only">
          {instantFilterText[lang].updating}
        </span>
      )}
      {error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (contactError) void navigate(criteriaRef.current);
                else void listing.refetch();
              }}
            >
              {lang === "zh" ? "重试" : "Retry"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-label={t.pipeline} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[15px] font-semibold">{t.pipeline}</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !activeQuery.status.length}
            onClick={() => changeCriteria({ status: [] })}
          >
            {t.allStages}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {stages.map((stage) => {
            const code = Object.keys(stageLabels).find(
              (key) => stageLabels[key as RecruitmentStage] === stage,
            ) as RecruitmentStage;
            const count = result.counts[code];
            const active = activeQuery.status.includes(code);
            return (
              <button
                key={stage}
                type="button"
                className={cn(
                  "flex cursor-pointer flex-col gap-1.5 rounded-lg border px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60",
                  active
                    ? "border-primary/50 bg-accent"
                    : "border-border bg-card hover:bg-muted",
                )}
                disabled={busy}
                aria-pressed={active}
                onClick={() =>
                  navigate({
                    ...activeQuery,
                    page: 1,
                    status: active
                      ? activeQuery.status.filter((s) => s !== code)
                      : [...activeQuery.status, code],
                  })
                }
              >
                <span className="text-xs text-muted-foreground">
                  {applicationStatusTone[stage].label[lang]}
                </span>
                <span className="text-2xl leading-none font-bold tabular-nums">
                  {loading ? <Bone width={32} height={24} /> : count}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <Card variant="panel" className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="m-0 text-[15px] font-semibold">{t.listTitle}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {loading ? (
                <Bone width={150} height={11} />
              ) : (
                <>
                  {t.showing} {visible.length} {t.of} {result.total} ·{" "}
                  {timeZone}
                </>
              )}
            </p>
          </div>
          <ExportMenu
            label={r.pageExport}
            lang={lang}
            report={report}
            disabled={loading || busy || !!error}
            title={t.title}
            sheetName={t.title}
            filenamePrefix="applications"
            headers={exportHeaders}
            rows={exportRows}
            onEmpty={() => toast(t.exportEmpty)}
          />
        </div>
        <BulkActionBar
          lang={lang}
          count={selection.count}
          busy={bulkPending}
          onClear={selection.clear}
        >
          {canEdit
            ? (["SCREENING", "REJECTED"] as const).map((stage) =>
                bulkTargets(stage).length ? (
                  <Button
                    key={stage}
                    variant="outline"
                    size="sm"
                    disabled={bulkPending || busy}
                    onClick={() => setBulkStage(stage)}
                  >
                    {bulk.actions[stage]} ({bulkTargets(stage).length})
                  </Button>
                ) : null,
              )
            : null}
          <ExportMenu
            label={bulk.exportSelected}
            lang={lang}
            report={selectedExport.report}
            disabled={bulkPending || busy}
            title={t.title}
            sheetName={t.title}
            filenamePrefix="applications-selected"
            headers={selectedExport.headers}
            rows={selectedExport.rows}
            onEmpty={() => toast(t.exportEmpty)}
          />
        </BulkActionBar>
        <div
          aria-busy={busy}
          className="transition-opacity duration-150 aria-busy:opacity-60"
        >
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <AdminSelectCheckbox
                    label={tt.selectAll}
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    disabled={visible.length === 0}
                    onChange={selection.toggleAll}
                  />
                </TableHead>
                <TableHead>{t.columns.candidate}</TableHead>
                <TableHead>{t.columns.job}</TableHead>
                <TableHead>{t.columns.source}</TableHead>
                <TableHead>{t.columns.submitted}</TableHead>
                <TableHead>{t.columns.status}</TableHead>
                <TableHead className="text-right">
                  {t.columns.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRowsSkeleton columns={7} leading trailingRight />
              ) : null}
              {visible.map((app) => {
                const status = applicationStatusTone[app.status];
                const detailHref = `/admin/applications/${app.id}?${langQuery}&back=${encodeURIComponent(applicationListHref(activeQuery, lang))}`;
                return (
                  <TableRow
                    key={app.id}
                    className="cursor-pointer"
                    data-selected={selection.isSelected(app.id)}
                    onClick={() => {
                      if (!busy) router.push(detailHref);
                    }}
                  >
                    <TableCell>
                      <AdminSelectCheckbox
                        label={`${tt.selectRow}: ${app.name || app.id.slice(0, 8)}`}
                        checked={selection.isSelected(app.id)}
                        onChange={() => selection.toggle(app.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8 bg-accent" aria-hidden="true">
                          <AvatarFallback className="bg-accent text-[13px] font-bold text-primary">
                            {app.name.trim().slice(0, 1).toUpperCase() || (
                              <User className="size-4" />
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <Link
                            className="text-sm font-medium text-foreground hover:underline"
                            href={detailHref}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {app.name || `${t.detailId} ${app.id.slice(0, 8)}`}
                          </Link>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {app.email ||
                              `${t.applicationId}: ${app.id.slice(0, 8)}`}
                          </span>
                          {app.duplicate && (
                            <Badge
                              tone="amber"
                              className="mt-1 gap-1 px-1.5 py-0.5 text-[11px]"
                              title={t.duplicateNote}
                            >
                              <TriangleAlert
                                className="size-3"
                                aria-hidden="true"
                              />
                              {t.duplicateTag}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-foreground">
                      {jobTitles[app.jobId] ?? app.jobId}
                    </TableCell>
                    <TableCell>{t.sources[app.source]}</TableCell>
                    <TableCell title={timeZone}>
                      <time dateTime={app.submittedAt}>
                        {Number.isFinite(Date.parse(app.submittedAt)) ? (
                          <>
                            {dateFormat.format(new Date(app.submittedAt))}
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {timeFormat.format(new Date(app.submittedAt))}
                            </span>
                          </>
                        ) : (
                          <EmptyValue />
                        )}
                      </time>
                    </TableCell>
                    <TableCell>
                      <Badge tone={status.tone}>{status.label[lang]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <ApplicationRowActions
                        detailHref={detailHref}
                        viewLabel={t.viewDetails}
                        downloadLabel={t.download}
                        pendingTitle={t.actionsPending}
                        applicationId={app.id}
                        canDownload={app.cvAvailable === true}
                        lang={lang}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!loading && !visible.length && (
            <EmptyState icon={Inbox} title={t.emptyResults} />
          )}
        </div>
        {loading ? (
          <div className="flex items-center justify-between gap-4 px-5 py-3">
            <Bone width={120} height={12} />
            <Bone width={140} height={32} />
          </div>
        ) : (
          <AdminPagination
            lang={lang}
            page={result.page}
            pageSize={result.pageSize}
            rowCount={visible.length}
            total={result.total}
            busy={busy}
            onPageChange={(next) => navigate({ ...activeQuery, page: next })}
            onPageSizeChange={(size) =>
              navigate({ ...activeQuery, page: 1, pageSize: size })
            }
          />
        )}
      </Card>
      <BulkConfirmDialog
        lang={lang}
        open={bulkStage !== null}
        title={
          bulkStage
            ? bulk.confirmTitle(bulkStage, bulkTargets(bulkStage).length)
            : ""
        }
        description={
          bulkStage
            ? bulk.confirmBody[bulkStage] +
              (selectedApplications.length > bulkTargets(bulkStage).length
                ? bulk.skipped(
                    selectedApplications.length - bulkTargets(bulkStage).length,
                  )
                : "")
            : ""
        }
        confirmLabel={bulkStage ? bulk.actions[bulkStage] : ""}
        destructive={bulkStage === "REJECTED"}
        pending={bulkPending}
        onConfirm={() => bulkStage && void runBulk(bulkStage)}
        onCancel={() => setBulkStage(null)}
      />
    </div>
  );
}
