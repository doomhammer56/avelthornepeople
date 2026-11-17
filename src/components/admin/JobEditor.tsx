"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminRouter as useRouter } from "./AdminNavigation";
import { AdminLink as Link } from "./AdminNavigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleX,
  Copy,
  Info,
  LoaderCircle,
  Pause,
  Play,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { EmptyValue } from "./ui/empty-value";
import { FormField } from "./ui/form-field";
import { AdminPageHeader } from "./ui/page-header";
import { Segmented } from "./ui/segmented";
import { jobStatusTone } from "@/lib/admin/jobStatus";
import type { AdminJob } from "@/lib/admin/jobFields";
import type { AdminSettings } from "@/lib/admin/adminSettings";
import { jobEditorContent } from "@/lib/admin/jobEditorContent";
import { jobManagementContent } from "@/lib/admin/jobManagementContent";
import type { AdminLang } from "@/lib/admin/nav";
import { sendJobCommand, JobRequestError } from "@/lib/admin/jobClient";
import { jobEditorInput, rezoneSchedule } from "@/lib/admin/jobEditorInput";
import { useAdminTimeZone } from "@/lib/admin/useAdminTimeZone";
import { TimeZonePreference, timeZoneContent } from "./TimeZonePreference";
import { JobRecruitingFields } from "./JobRecruitingFields";
import {
  textareaLines,
  linesTextarea,
  jobValidationContent,
  hasJobLanguageContent,
  jobPublicationIssues,
  type JobIssue,
} from "@/lib/admin/jobValidation";
import { AdminRequestError, signInAgain } from "@/lib/admin/staffClient";
import type { JobDraft } from "@/server/jobs/management-contract";
import { referenceLabel } from "@/lib/admin/referenceData";
import { jobIssueMessage } from "@/lib/admin/jobEditorFeedback";

type Props = {
  job: AdminJob;
  settings: AdminSettings;
  lang: AdminLang;
  isNew: boolean;
  canEdit: boolean;
  canPublish: boolean;
};
type Action =
  "save" | "submit" | "publish" | "pause" | "resume" | "close" | "duplicate";
export function JobEditor({
  job: initial,
  settings,
  lang,
  isNew,
  canEdit,
  canPublish,
}: Props) {
  const router = useRouter(),
    t = jobEditorContent[lang],
    m = jobManagementContent[lang];
  const [job, setJob] = useState(initial),
    [draft, setDraft] = useState(initial.draft),
    [slug, setSlug] = useState(initial.slug || `job-${initial.id}`);
  // Open the content language selected in the console.
  // Both translations remain editable without changing the saved job data.
  const [tab, setTab] = useState<"zh" | "en">(lang),
    [step, setStep] = useState(1);
  const [issues, setIssues] = useState<JobIssue[]>([]);
  const [salaryInputs, setSalaryInputs] = useState({
    min: initial.draft.settings.salary?.min.toString() ?? "",
    max: initial.draft.settings.salary?.max.toString() ?? "",
  });
  const zone = useAdminTimeZone();
  const [scheduleState, setScheduleState] = useState({
    timeZone: "UTC",
    original: initial.draft.settings,
    values: {
      publishAt: initial.draft.settings.publishAt?.slice(0, -1) ?? "",
      closeAt: initial.draft.settings.closeAt?.slice(0, -1) ?? "",
    },
  });
  const schedule = useMemo(
    () =>
      rezoneSchedule(
        scheduleState.values,
        scheduleState.timeZone,
        zone.timeZone,
        scheduleState.original,
      ),
    [scheduleState, zone.timeZone],
  );
  const scheduleInputs = schedule.values,
    scheduleTimeZone = schedule.timeZone;
  function changeTimeZone(value: string) {
    const converted = rezoneSchedule(
      scheduleInputs,
      scheduleTimeZone,
      value || zone.detected,
      schedule.original,
    );
    if (converted.issues.length) {
      showIssues(converted.issues);
      setError(m.validationFailed);
      return;
    }
    setScheduleState({
      values: converted.values,
      timeZone: converted.timeZone,
      original: { ...draft.settings, ...converted.original },
    });
    zone.setPreference(value);
  }
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const busy = pendingAction !== null;
  const [error, setError] = useState("");
  const errorSummary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!error) return;
    const summary = errorSummary.current;
    summary?.focus({ preventScroll: true });
    summary?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
    // A new issue list also reveals repeated validation failures with the same
    // summary text, including synchronous salary/schedule validation failures.
  }, [error, issues]);
  const [persisted, setPersisted] = useState(!isNew),
    [recoveryId, setRecoveryId] = useState(initial.id);
  const inFlight = useRef(false),
    duplicateId = useRef<string | null>(null);
  const editable = canEdit && job.status !== "closed";
  const settingsEditable = editable && !job.settingsLocked;
  const s = draft.settings;
  const languageRequired =
    hasJobLanguageContent(draft[tab]) ||
    !hasJobLanguageContent(draft[tab === "en" ? "zh" : "en"]);
  const requiredMark = (
    <span className="font-bold text-destructive" aria-hidden="true">
      {" "}
      *
    </span>
  );
  const setSetting = <K extends keyof JobDraft["settings"]>(
    key: K,
    value: JobDraft["settings"][K],
  ) =>
    setDraft((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value },
    }));
  const setContent = (
    key: "title" | "responsibilities" | "requirements",
    value: string,
  ) =>
    setDraft((current) => ({
      ...current,
      [tab]: {
        ...current[tab],
        [key]: key === "title" ? value : textareaLines(value),
      },
    }));
  function showIssues(value: JobIssue[]) {
    setIssues(value);
    const first = value[0]?.field;
    if (first?.startsWith("draft.zh.") || first?.startsWith("draft.en.")) {
      setTab(first.startsWith("draft.en.") ? "en" : "zh");
      setStep(1);
    } else if (first?.startsWith("draft.settings.") || first === "slug")
      setStep(2);
    else if (first === "draft") setStep(1);
  }
  const fieldError = (field: string) => {
    const issue = issues.find((i) => i.field === field);
    return issue ? (
      <small
        id={`error-${field}`}
        className="text-xs leading-normal text-destructive"
      >
        {jobValidationContent[lang][issue.code]}
      </small>
    ) : null;
  };
  const fieldAccessibility = (field: string) => ({
    "aria-invalid": issues.some((i) => i.field === field) || undefined,
    "aria-describedby": issues.some((i) => i.field === field)
      ? `error-${field}`
      : undefined,
  });

  async function commit(action: Action) {
    if (inFlight.current) return;
    if (!zone.ready) return;
    if (action === "close" && !window.confirm(m.confirmClose)) return;
    inFlight.current = true;
    setPendingAction(action);
    setError("");
    setIssues([]);
    try {
      let saved = job;
      if (["save", "submit", "publish"].includes(action)) {
        if (!job.settingsLocked && schedule.issues.length) {
          showIssues(schedule.issues);
          setError(m.validationFailed);
          return;
        }
        const input = job.settingsLocked
          ? { draft: { ...draft, settings: job.draft.settings }, issues: [] }
          : jobEditorInput(
              draft,
              salaryInputs,
              scheduleInputs,
              scheduleTimeZone,
              schedule.original,
            );
        if (input.issues.length) {
          showIssues(input.issues);
          setError(m.validationFailed);
          return;
        }
        if (action === "submit" || action === "publish") {
          const publicationIssues = jobPublicationIssues(input.draft);
          if (publicationIssues.length) {
            showIssues(publicationIssues);
            setError(m.validationFailed);
            return;
          }
        }
        const body = {
          requestId: crypto.randomUUID(),
          slug,
          draft: input.draft,
        };
        saved = persisted
          ? await sendJobCommand(`/api/admin/jobs/${job.id}`, "PATCH", {
              ...body,
              expectedVersion: job.version,
            })
          : await sendJobCommand("/api/admin/jobs", "POST", {
              ...body,
              id: job.id,
            });
        setPersisted(true);
        setJob(saved);
      }
      if (action === "publish" && saved.status === "draft") {
        saved = await sendJobCommand(
          `/api/admin/jobs/${saved.id}/actions`,
          "POST",
          {
            requestId: crypto.randomUUID(),
            expectedVersion: saved.version,
            action: "submit",
          },
        );
        setJob(saved);
      }
      if (action === "duplicate") {
        duplicateId.current ??= crypto.randomUUID();
        setRecoveryId(duplicateId.current);
        const copy = await sendJobCommand(
          `/api/admin/jobs/${job.id}/duplicate`,
          "POST",
          {
            requestId: crypto.randomUUID(),
            expectedVersion: job.version,
            id: duplicateId.current,
          },
        );
        router.push(`/admin/jobs/${copy.id}/edit?lang=${lang}`);
        router.refresh();
        return;
      }
      if (action !== "save") {
        saved = await sendJobCommand(
          `/api/admin/jobs/${saved.id}/actions`,
          "POST",
          {
            requestId: crypto.randomUUID(),
            expectedVersion: saved.version,
            action,
          },
        );
        setJob(saved);
      }
      setDraft(saved.draft);
      setSalaryInputs({
        min: saved.draft.settings.salary?.min.toString() ?? "",
        max: saved.draft.settings.salary?.max.toString() ?? "",
      });
      setScheduleState({
        timeZone: "UTC",
        original: saved.draft.settings,
        values: {
          publishAt: saved.draft.settings.publishAt?.slice(0, -1) ?? "",
          closeAt: saved.draft.settings.closeAt?.slice(0, -1) ?? "",
        },
      });
      toast.success(
        action === "save" && saved.hasUnpublishedChanges
          ? m.savedDraft
          : m.saved,
      );
      if (isNew) router.replace(`/admin/jobs/${saved.id}/edit?lang=${lang}`);
      else router.refresh();
    } catch (cause) {
      if (cause instanceof JobRequestError) showIssues(cause.issues);
      if (cause instanceof AdminRequestError && cause.status === 401) {
        signInAgain(lang);
        return;
      }
      setError(
        cause instanceof AdminRequestError
          ? cause instanceof JobRequestError && cause.issues.length
            ? m.validationFailed
            : cause.status === 409
              ? m.conflict
              : cause.status === 403
                ? m.denied
                : m.failed
          : m.uncertain,
      );
    } finally {
      inFlight.current = false;
      setPendingAction(null);
    }
  }
  const select = (
    label: string,
    key: "departmentId" | "jobType" | "experience",
    items: AdminSettings["departments"],
  ) => (
    <FormField
      label={
        <>
          {label}
          {requiredMark}
        </>
      }
      htmlFor={`job-${key}`}
    >
      <NativeSelect
        className="w-full"
        id={`job-${key}`}
        aria-required="true"
        {...fieldAccessibility(`draft.settings.${key}`)}
        value={s[key] ?? ""}
        onChange={(event) =>
          setSetting(
            key,
            key === "departmentId"
              ? event.target.value || null
              : event.target.value,
          )
        }
        disabled={!settingsEditable}
      >
        <NativeSelectOption value="" disabled={key !== "departmentId"}>
          {m.choose}
        </NativeSelectOption>
        {items
          .filter(
            (item) =>
              item.active ||
              (key === "departmentId" ? item.id : item.code) === s[key],
          )
          .map((item) => (
            <NativeSelectOption
              key={item.id}
              value={key === "departmentId" ? item.id : item.code}
              disabled={!item.active}
            >
              {item.label[lang] || item.label.zh}
            </NativeSelectOption>
          ))}
      </NativeSelect>
      {fieldError(`draft.settings.${key}`)}
    </FormField>
  );
  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <AdminPageHeader
        above={
          <Link
            href={`/admin/jobs?lang=${lang}`}
            className={buttonVariants({
              variant: "ghost",
              size: "sm",
              className: "-ml-3 w-fit",
            })}
          >
            <ArrowLeft aria-hidden="true" />
            {t.back}
          </Link>
        }
        title={
          draft[lang].title || draft.en.title || draft.zh.title || t.newHeading
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={jobStatusTone[job.status].tone}>
              {jobStatusTone[job.status].label[lang]}
            </Badge>
            {job.hasUnpublishedChanges ? <span>{m.unpublished}</span> : null}
          </span>
        }
      />
      {!canEdit ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertDescription>{m.permission}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert
          ref={errorSummary}
          variant="destructive"
          tabIndex={-1}
          className="scroll-mt-24"
        >
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-2">
            <p className="m-0">{error}</p>
            {issues.length ? (
              <ul className="m-0 list-disc ps-5">
                {issues.map((issue) => (
                  <li key={`${issue.field}:${issue.code}`}>
                    {jobIssueMessage(issue, lang)}
                  </li>
                ))}
              </ul>
            ) : (
              <Link
                href={`/admin/jobs/${recoveryId}/edit?lang=${lang}`}
                prefetch={false}
                onClick={() => router.refresh()}
                className="font-medium underline"
              >
                {m.reload}
              </Link>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      <nav className="grid grid-cols-3 gap-2" aria-label={t.stepOf(step, 3)}>
        {[t.step1, t.step2, t.step3].map((label, index) => {
          const active = step === index + 1;
          const done = step > index + 1;
          return (
            <button
              key={label}
              type="button"
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60",
                active
                  ? "border-primary/50 bg-accent text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
              aria-current={active ? "step" : undefined}
              disabled={busy}
              onClick={() => setStep(index + 1)}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  active || done
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
                aria-hidden="true"
              >
                {done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className="min-w-0 truncate">{label}</span>
            </button>
          );
        })}
      </nav>
      <p className="m-0 text-xs text-muted-foreground">{t.requiredNote}</p>
      <fieldset
        disabled={busy}
        aria-busy={busy}
        className="m-0 min-w-0 border-0 p-0"
      >
        <Card variant="panel" className="flex flex-col gap-6 p-6">
          {step === 1 ? (
            <div className="flex flex-col gap-5">
              <Segmented
                label={t.languageNote}
                value={tab}
                onChange={setTab}
                className="w-fit"
                options={([lang, lang === "en" ? "zh" : "en"] as const).map(
                  (code) => ({
                    value: code,
                    label: code === "zh" ? "中文" : "English",
                  }),
                )}
              />
              <p className="m-0 text-xs text-muted-foreground">
                {t.languageNote}
              </p>
              <FormField
                label={
                  <>
                    {t.titleLabel}
                    {languageRequired && requiredMark}
                  </>
                }
                htmlFor="job-title"
              >
                <Input
                  id="job-title"
                  aria-required={languageRequired}
                  {...fieldAccessibility(`draft.${tab}.title`)}
                  maxLength={200}
                  value={draft[tab].title}
                  onChange={(e) => setContent("title", e.target.value)}
                  disabled={!editable}
                />
                {fieldError(`draft.${tab}.title`)}
              </FormField>
              <div className="grid gap-5 xl:grid-cols-2">
                {(["responsibilities", "requirements"] as const).map((key) => (
                  <FormField
                    key={key}
                    htmlFor={`job-${key}`}
                    label={
                      <>
                        {key === "responsibilities" ? t.duties : t.requirements}{" "}
                        ({t.dutiesHint}){languageRequired && requiredMark}
                      </>
                    }
                  >
                    <Textarea
                      id={`job-${key}`}
                      aria-required={languageRequired}
                      {...fieldAccessibility(`draft.${tab}.${key}`)}
                      rows={10}
                      className="min-h-64 max-h-[36rem] field-sizing-content"
                      value={linesTextarea(draft[tab][key])}
                      onChange={(e) => setContent(key, e.target.value)}
                      disabled={!editable}
                    />
                    {fieldError(`draft.${tab}.${key}`)}
                  </FormField>
                ))}
              </div>
              <JobRecruitingFields
                lang={lang}
                tab={tab}
                value={draft.recruiting}
                disabled={!editable}
                onChange={(recruiting) =>
                  setDraft((current) => ({ ...current, recruiting }))
                }
              />
            </div>
          ) : null}
          {step === 2 ? (
            <div className="flex flex-col gap-5">
              <p className="m-0 text-xs text-muted-foreground">
                {job.settingsLocked ? t.settingsLockedNote : t.settingsLockNote}
              </p>
              <FormField
                label={
                  <>
                    {m.slug}
                    {requiredMark}
                  </>
                }
                htmlFor="job-slug"
              >
                <Input
                  id="job-slug"
                  aria-required="true"
                  {...fieldAccessibility("slug")}
                  value={slug}
                  maxLength={180}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={
                    !settingsEditable ||
                    ["published", "paused", "closed"].includes(job.status)
                  }
                />
                {fieldError("slug")}
              </FormField>
              <div className="grid gap-5 md:grid-cols-3">
                {select(t.department, "departmentId", settings.departments)}
                {select(t.type, "jobType", settings.jobTypes)}
                {select(t.experience, "experience", settings.experienceLevels)}
              </div>
              <fieldset className="m-0 grid gap-2 border-0 p-0 sm:grid-cols-2 lg:grid-cols-3">
                <legend className="col-span-full mb-1 text-[13px] font-medium text-foreground/80">
                  {t.location}
                  {requiredMark}
                </legend>
                <div className="col-span-full empty:hidden">
                  {fieldError("draft.settings.locationIds")}
                </div>
                {settings.locations
                  .filter(
                    (item) => item.active || s.locationIds.includes(item.id),
                  )
                  .map((item) => (
                    <label
                      className="flex cursor-pointer items-center gap-2 text-[13px]"
                      key={item.id}
                    >
                      <Checkbox
                        checked={s.locationIds.includes(item.id)}
                        disabled={
                          !settingsEditable ||
                          (!item.active && !s.locationIds.includes(item.id))
                        }
                        onCheckedChange={(checked) =>
                          setSetting(
                            "locationIds",
                            checked
                              ? [...s.locationIds, item.id]
                              : s.locationIds.filter((id) => id !== item.id),
                          )
                        }
                      />
                      {item.label[lang] || item.label.zh}
                    </label>
                  ))}
              </fieldset>
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <Checkbox
                  checked={!!s.salary}
                  disabled={!settingsEditable}
                  onCheckedChange={(checked) => {
                    setSetting(
                      "salary",
                      checked
                        ? { min: 0, max: 0, currency: "USD", period: "MONTH" }
                        : null,
                    );
                    if (!checked) setSetting("showSalary", false);
                    setSalaryInputs({ min: "", max: "" });
                  }}
                />
                {m.salary}
              </label>
              {fieldError("draft.settings.salary")}
              {s.salary ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {(["min", "max"] as const).map((key) => (
                    <FormField
                      key={key}
                      htmlFor={`job-salary-${key}`}
                      label={
                        <>
                          {key === "min" ? m.minimum : m.maximum}
                          {requiredMark}
                        </>
                      }
                    >
                      <Input
                        id={`job-salary-${key}`}
                        aria-required="true"
                        {...fieldAccessibility(`draft.settings.salary.${key}`)}
                        type="number"
                        min="0"
                        step="0.01"
                        value={salaryInputs[key]}
                        disabled={!settingsEditable}
                        onChange={(e) =>
                          setSalaryInputs((current) => ({
                            ...current,
                            [key]: e.target.value,
                          }))
                        }
                      />
                      {fieldError(`draft.settings.salary.${key}`)}
                    </FormField>
                  ))}
                  <FormField
                    htmlFor="job-salary-currency"
                    label={
                      <>
                        {m.currency}
                        {requiredMark}
                      </>
                    }
                  >
                    <Input
                      id="job-salary-currency"
                      aria-required="true"
                      {...fieldAccessibility("draft.settings.salary.currency")}
                      maxLength={3}
                      value={s.salary.currency}
                      disabled={!settingsEditable}
                      onChange={(e) =>
                        setSetting("salary", {
                          ...s.salary!,
                          currency: e.target.value.toUpperCase(),
                        })
                      }
                    />
                    {fieldError("draft.settings.salary.currency")}
                  </FormField>
                  <FormField
                    htmlFor="job-salary-period"
                    label={
                      <>
                        {m.period}
                        {requiredMark}
                      </>
                    }
                  >
                    <NativeSelect
                      className="w-full"
                      id="job-salary-period"
                      aria-required="true"
                      {...fieldAccessibility("draft.settings.salary.period")}
                      value={s.salary.period}
                      disabled={!settingsEditable}
                      onChange={(e) =>
                        setSetting("salary", {
                          ...s.salary!,
                          period: e.target.value as "MONTH",
                        })
                      }
                    >
                      {["HOUR", "DAY", "MONTH", "YEAR"].map((p) => (
                        <NativeSelectOption key={p}>{p}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                    {fieldError("draft.settings.salary.period")}
                  </FormField>
                </div>
              ) : null}
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <Checkbox
                  {...fieldAccessibility("draft.settings.showSalary")}
                  checked={s.showSalary}
                  disabled={!settingsEditable || !s.salary}
                  onCheckedChange={(checked) =>
                    setSetting("showSalary", checked)
                  }
                />
                {t.showSalary}
                {fieldError("draft.settings.showSalary")}
              </label>
              <TimeZonePreference
                lang={lang}
                onChange={changeTimeZone}
                disabled={busy}
              />
              <p className="m-0 text-xs text-muted-foreground">
                {timeZoneContent[lang].hint}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {(["publishAt", "closeAt"] as const).map((key) => (
                  <FormField
                    key={key}
                    htmlFor={`job-${key}`}
                    label={`${key === "publishAt" ? t.postedDate : t.closingDate} (${
                      zone.ready
                        ? scheduleTimeZone
                        : timeZoneContent[lang].detecting
                    })`}
                  >
                    <Input
                      id={`job-${key}`}
                      {...fieldAccessibility(`draft.settings.${key}`)}
                      type="datetime-local"
                      step="0.001"
                      value={scheduleInputs[key]}
                      disabled={!settingsEditable || !zone.ready}
                      onChange={(e) =>
                        setScheduleState({
                          timeZone: scheduleTimeZone,
                          original: { ...draft.settings, ...schedule.original },
                          values: { ...scheduleInputs, [key]: e.target.value },
                        })
                      }
                    />
                    {fieldError(`draft.settings.${key}`)}
                  </FormField>
                ))}
              </div>
              <p className="m-0 text-xs text-muted-foreground">{m.schedule}</p>
              <p className="m-0 text-xs text-muted-foreground">{m.expired}</p>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="flex flex-col gap-5">
              <p className="m-0 text-sm">{t.reviewNote}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {([lang, lang === "en" ? "zh" : "en"] as const).map((code) => (
                  <div
                    key={code}
                    lang={code === "zh" ? "zh-CN" : "en"}
                    className="rounded-lg bg-muted px-3 py-2.5"
                  >
                    <span className="text-xs text-muted-foreground">
                      {code === "en" ? "English" : "中文"}
                    </span>
                    <p className="m-0 mt-0.5 text-sm font-medium">
                      {draft[code].title ||
                        (hasJobLanguageContent(draft[code])
                          ? t.tabMissing
                          : t.tabOptional)}
                    </p>
                  </div>
                ))}
              </div>
              <dl className="m-0 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {[
                  [
                    t.department,
                    referenceLabel(
                      settings.departments,
                      s.departmentId ?? "",
                      lang,
                    ),
                  ],
                  [
                    t.location,
                    s.locationIds
                      .map((id) => referenceLabel(settings.locations, id, lang))
                      .join(", "),
                  ],
                  [t.type, referenceLabel(settings.jobTypes, s.jobType, lang)],
                  [
                    t.experience,
                    referenceLabel(
                      settings.experienceLevels,
                      s.experience,
                      lang,
                    ),
                  ],
                  [
                    t.salaryRange,
                    s.salary
                      ? `${s.salary.currency} ${salaryInputs.min || "—"}–${salaryInputs.max || "—"} / ${s.salary.period}`
                      : m.noSalary,
                  ],
                  [
                    `${t.postedDate} (${scheduleTimeZone})`,
                    scheduleInputs.publishAt,
                  ],
                  [
                    `${t.closingDate} (${scheduleTimeZone})`,
                    scheduleInputs.closeAt,
                  ],
                ].map(([label, value]) => (
                  <div className="flex min-w-0 flex-col gap-1" key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="m-0 text-sm break-words">
                      {value || <EmptyValue />}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="m-0 text-sm">
                {t.siteUrl}:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all">
                  /{lang}/jobs/{slug}
                </code>
              </p>
              <p className="m-0 text-xs text-muted-foreground">
                {t.languageNote}
              </p>
              {editable ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => commit("save")}>
                    {pendingAction === "save" && (
                      <LoaderCircle
                        className="animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    )}
                    {pendingAction === "save" ? m.saving : t.saveDraft}
                  </Button>
                  {job.status === "draft" || job.status === "pending" ? (
                    <Button variant="outline" onClick={() => commit("submit")}>
                      {pendingAction === "submit" && (
                        <LoaderCircle
                          className="animate-spin motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      )}
                      {pendingAction === "submit"
                        ? m.submitting
                        : t.submitReview}
                    </Button>
                  ) : null}
                  {canPublish ? (
                    <Button
                      disabled={busy}
                      aria-busy={pendingAction === "publish"}
                      onClick={() => commit("publish")}
                    >
                      {pendingAction === "publish" && (
                        <LoaderCircle
                          className="animate-spin motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      )}
                      {pendingAction === "publish" ? m.publishing : t.publish}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            {step > 1 ? (
              <Button variant="outline" onClick={() => setStep(step - 1)}>
                <ChevronLeft aria-hidden="true" />
                {t.stepBack}
              </Button>
            ) : null}
            {step < 3 ? (
              <Button onClick={() => setStep(step + 1)}>
                {t.stepNext}
                <ChevronRight aria-hidden="true" />
              </Button>
            ) : null}
            {canEdit && persisted ? (
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => commit("duplicate")}>
                  <Copy aria-hidden="true" />
                  {m.duplicate}
                </Button>
                {job.status === "published" ? (
                  <Button variant="outline" onClick={() => commit("pause")}>
                    <Pause aria-hidden="true" />
                    {m.pause}
                  </Button>
                ) : null}
                {job.status === "paused" && canPublish ? (
                  <Button variant="outline" onClick={() => commit("resume")}>
                    <Play aria-hidden="true" />
                    {m.resume}
                  </Button>
                ) : null}
                {["published", "paused"].includes(job.status) ? (
                  <Button
                    variant="destructive-outline"
                    onClick={() => commit("close")}
                  >
                    <CircleX aria-hidden="true" />
                    {m.close}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </Card>
      </fieldset>
    </div>
  );
}
