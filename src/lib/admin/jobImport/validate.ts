// Pure validation for job-import rows. No database, no network: the server
// loads references and existing jobs, then calls this for both the preview and
// the commit, so both always apply the same rules.
import {
  jobDraftSchema,
  type JobDraft,
} from "../../../server/jobs/management-contract.ts";
import type { ReferenceItem } from "../referenceData.ts";
import {
  genderOptions,
  importColumnKeys,
  importLimits,
  priorityOptions,
  recruitingNoteFields,
  salaryPeriodAliases,
  type ImportColumnKey,
} from "./columns.ts";

export type ImportRowInput = {
  /** Spreadsheet row number, so "Row 14" matches what the user sees in Excel. */
  row: number;
  cells: Partial<Record<ImportColumnKey, string>>;
};

export type ImportRefs = {
  departments: readonly ReferenceItem[];
  locations: readonly ReferenceItem[];
  jobTypes: readonly ReferenceItem[];
  experienceLevels: readonly ReferenceItem[];
};

export type ExistingJob = {
  id: string;
  version: number;
  status: string;
  settingsLocked: boolean;
  draft: JobDraft;
};

export const importIssueCodes = [
  "required",
  "invalid",
  "invalid_option",
  "ambiguous_option",
  "invalid_number",
  "precision",
  "invalid_range",
  "too_long",
  "too_many",
  "incomplete_group",
  "salary_required",
  "duplicate_in_file",
  "ambiguous_duplicate",
  "settings_locked",
] as const;
export type ImportIssueCode = (typeof importIssueCodes)[number];
export type ImportIssue = {
  column: ImportColumnKey | null;
  code: ImportIssueCode;
  /** The earlier row that a duplicate_in_file issue points at. */
  otherRow?: number;
};

export type DuplicateChoice = "skip" | "overwrite";
export type ImportDecisions = {
  default: DuplicateChoice | null;
  perRow: Readonly<Record<number, DuplicateChoice>>;
};
export const noDecisions: ImportDecisions = { default: null, perRow: {} };

export type ImportRowStatus = "ok" | "error" | "duplicate" | "skipped";
export type ImportRowResult = {
  row: number;
  status: ImportRowStatus;
  issues: ImportIssue[];
  /** What confirming will do with this row; absent while it is undecided or invalid. */
  action?: "create" | "overwrite" | "skip";
  duplicate?: { id: string; version: number; status: string };
};
export type ImportPlanItem = {
  row: number;
  action: "create" | "overwrite";
  draft: JobDraft;
  existingId?: string;
  existingVersion?: number;
};
export type ImportValidation = {
  rows: ImportRowResult[];
  plan: ImportPlanItem[];
  summary: {
    total: number;
    create: number;
    overwrite: number;
    skipped: number;
    errors: number;
    undecided: number;
  };
  canConfirm: boolean;
};

const yes = new Set(["yes", "y", "true", "1", "是", "显示", "✓"]);
const no = new Set(["no", "n", "false", "0", "否", "不显示"]);

export function matchKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
function cell(input: ImportRowInput, key: ImportColumnKey): string {
  return (input.cells[key] ?? "").replace(/ /g, " ").trim();
}

// "1." / "1、" / "(1)" / "①" list numbering would double up with the bullets the
// public page renders. "1.5 years" is left alone.
const numbering =
  /^\s*(?:[（(]\s*\d{1,2}\s*[)）]|\d{1,2}\s*[.．](?!\d)|\d{1,2}\s*[、)）]|[①-⑳])\s*/u;
export function importLines(value: string): string[] {
  return value
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(numbering, "").trim())
    .filter(Boolean);
}

type Resolved<T> =
  { value: T } | { code: "invalid_option" | "ambiguous_option" };
function resolveReference(
  items: readonly ReferenceItem[],
  raw: string,
): Resolved<ReferenceItem> {
  const wanted = matchKey(raw);
  const found = items.filter(
    (item) =>
      item.active &&
      [item.code, item.label.zh, item.label.en].some(
        (name) => name && matchKey(name) === wanted,
      ),
  );
  if (found.length === 1) return { value: found[0] };
  return { code: found.length ? "ambiguous_option" : "invalid_option" };
}

type Choice = {
  code: string;
  zh: string;
  en: string;
  aliases: readonly string[];
};
function matchChoice(
  options: readonly Choice[],
  raw: string,
): string | undefined {
  const wanted = matchKey(raw);
  return options.find((option) =>
    [option.code, option.zh, option.en, ...option.aliases].some(
      (name) => matchKey(name) === wanted,
    ),
  )?.code;
}

const columnForPath = (
  path: readonly PropertyKey[],
): ImportColumnKey | null => {
  const [scope, field, extra] = path;
  if (scope === "zh" || scope === "en") {
    const suffix = scope;
    if (field === "title") return `title_${suffix}`;
    if (field === "responsibilities") return `responsibilities_${suffix}`;
    if (field === "requirements") return `requirements_${suffix}`;
    return null;
  }
  if (scope === "recruiting") {
    if (field === "priority" || field === "gender") return field;
    const note = recruitingNoteFields.find((entry) => entry.field === field);
    return note && (extra === "en" || extra === "zh")
      ? (`${note.column}_${extra}` as ImportColumnKey)
      : null;
  }
  if (scope !== "settings") return null;
  if (field === "departmentId") return "project";
  if (field === "locationIds") return "location";
  if (field === "jobType") return "job_type";
  if (field === "experience") return "experience";
  if (field === "showSalary") return "show_salary";
  if (field === "salary")
    return extra === "min" || extra === "max"
      ? `salary_${extra}`
      : extra === "currency"
        ? "salary_currency"
        : extra === "period"
          ? "salary_period"
          : "salary_min";
  return null;
};

function amount(
  raw: string,
  column: "salary_min" | "salary_max",
  issues: ImportIssue[],
): number | undefined {
  const text = raw.replace(/[,，\s]/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) {
    issues.push({ column, code: "invalid_number" });
    return undefined;
  }
  if ((text.split(".")[1]?.length ?? 0) > 2) {
    issues.push({ column, code: "precision" });
    return undefined;
  }
  return Number(text);
}

type BuiltRow = {
  issues: ImportIssue[];
  draft?: JobDraft;
  key?: string;
  departmentId?: string;
};

function buildRow(input: ImportRowInput, refs: ImportRefs): BuiltRow {
  const issues: ImportIssue[] = [];
  const need = (key: ImportColumnKey) => {
    if (!cell(input, key)) {
      issues.push({ column: key, code: "required" });
      return false;
    }
    return true;
  };
  for (const key of importColumnKeys)
    if ((input.cells[key] ?? "").length > importLimits.maxCellChars)
      issues.push({ column: key, code: "too_long" });

  const titleZh = cell(input, "title_zh");
  need("title_zh");
  const responsibilitiesZh = importLines(cell(input, "responsibilities_zh"));
  if (!responsibilitiesZh.length)
    issues.push({ column: "responsibilities_zh", code: "required" });
  const requirementsZh = importLines(cell(input, "requirements_zh"));
  if (!requirementsZh.length)
    issues.push({ column: "requirements_zh", code: "required" });

  let departmentId: string | null = null;
  if (need("project")) {
    const found = resolveReference(refs.departments, cell(input, "project"));
    if ("value" in found) departmentId = found.value.id;
    else issues.push({ column: "project", code: found.code });
  }

  const locationIds: string[] = [];
  if (need("location")) {
    for (const part of cell(input, "location")
      .split(/[,，;；、\n]+/)
      .map((p) => p.trim())
      .filter(Boolean)) {
      const found = resolveReference(refs.locations, part);
      if ("value" in found) {
        if (!locationIds.includes(found.value.id))
          locationIds.push(found.value.id);
      } else if (!issues.some((i) => i.column === "location"))
        issues.push({ column: "location", code: found.code });
    }
  }

  const optionCode = (
    key: "job_type" | "experience",
    items: readonly ReferenceItem[],
    fallback: string,
  ) => {
    const raw = cell(input, key);
    if (!raw) return fallback;
    const found = resolveReference(items, raw);
    if ("value" in found) return found.value.code;
    issues.push({ column: key, code: found.code });
    return fallback;
  };
  const jobType = optionCode("job_type", refs.jobTypes, "FULL_TIME");
  const experience = optionCode("experience", refs.experienceLevels, "ANY");

  const salaryKeys = [
    "salary_min",
    "salary_max",
    "salary_currency",
    "salary_period",
  ] as const;
  let salary: NonNullable<JobDraft["settings"]["salary"]> | null = null;
  if (salaryKeys.some((key) => cell(input, key))) {
    const missing = salaryKeys.filter((key) => !cell(input, key));
    for (const key of missing)
      issues.push({ column: key, code: "incomplete_group" });
    if (!missing.length) {
      const min = amount(cell(input, "salary_min"), "salary_min", issues);
      const max = amount(cell(input, "salary_max"), "salary_max", issues);
      const currency = cell(input, "salary_currency").toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency))
        issues.push({ column: "salary_currency", code: "invalid_option" });
      const period =
        salaryPeriodAliases[matchKey(cell(input, "salary_period"))];
      if (!period)
        issues.push({ column: "salary_period", code: "invalid_option" });
      if (min !== undefined && max !== undefined && min > max)
        issues.push({ column: "salary_max", code: "invalid_range" });
      if (
        min !== undefined &&
        max !== undefined &&
        min <= max &&
        /^[A-Z]{3}$/.test(currency) &&
        period
      )
        salary = { min, max, currency, period };
    }
  }

  let showSalary = false;
  const showRaw = matchKey(cell(input, "show_salary"));
  if (showRaw) {
    if (yes.has(showRaw)) showSalary = true;
    else if (!no.has(showRaw))
      issues.push({ column: "show_salary", code: "invalid_option" });
  }
  if (
    showSalary &&
    !salary &&
    !issues.some((i) => i.column?.startsWith("salary_"))
  )
    issues.push({ column: "show_salary", code: "salary_required" });

  const english = {
    title_en: cell(input, "title_en"),
    responsibilities_en: importLines(cell(input, "responsibilities_en")),
    requirements_en: importLines(cell(input, "requirements_en")),
  };
  const englishStarted =
    !!english.title_en ||
    english.responsibilities_en.length > 0 ||
    english.requirements_en.length > 0;
  if (englishStarted) {
    if (!english.title_en)
      issues.push({ column: "title_en", code: "incomplete_group" });
    if (!english.responsibilities_en.length)
      issues.push({ column: "responsibilities_en", code: "incomplete_group" });
    if (!english.requirements_en.length)
      issues.push({ column: "requirements_en", code: "incomplete_group" });
  }

  // Staff-only details. Blank cells are simply left out.
  const recruiting: Record<string, unknown> = {};
  for (const key of ["priority", "gender"] as const) {
    const raw = cell(input, key);
    if (!raw) continue;
    const code = matchChoice(
      key === "priority" ? priorityOptions : genderOptions,
      raw,
    );
    if (code) recruiting[key] = code;
    else issues.push({ column: key, code: "invalid_option" });
  }
  for (const field of recruitingNoteFields) {
    const zh = cell(input, `${field.column}_zh` as ImportColumnKey);
    const en = cell(input, `${field.column}_en` as ImportColumnKey);
    if (zh || en)
      recruiting[field.field] = {
        ...(zh ? { zh } : {}),
        ...(en ? { en } : {}),
      };
  }

  const draft = {
    ...(Object.keys(recruiting).length ? { recruiting } : {}),
    zh: {
      title: titleZh,
      responsibilities: responsibilitiesZh,
      requirements: requirementsZh,
    },
    en: {
      title: english.title_en,
      responsibilities: english.responsibilities_en,
      requirements: english.requirements_en,
    },
    settings: {
      departmentId,
      locationIds,
      jobType,
      experience,
      salary,
      showSalary,
      publishAt: null,
      closeAt: null,
    },
  };
  // The editor's own contract enforces lengths and counts, so limits cannot drift.
  const parsed = jobDraftSchema.safeParse(draft);
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      // The contract's "salary required when shown" rule is already reported
      // above, against the Show salary column.
      if (issue.message === "required") continue;
      const column = columnForPath(issue.path);
      const code: ImportIssueCode =
        issue.code === "too_big"
          ? issue.origin === "array"
            ? "too_many"
            : "too_long"
          : issue.message === "invalid_range"
            ? "invalid_range"
            : "invalid";
      if (!issues.some((i) => i.column === column && i.code === code))
        issues.push({ column, code });
    }
  const key =
    titleZh && departmentId && locationIds.length
      ? duplicateKey(titleZh, departmentId, locationIds)
      : undefined;
  return {
    issues,
    key,
    departmentId: departmentId ?? undefined,
    draft: issues.length || !parsed.success ? undefined : parsed.data,
  };
}

// The same role is routinely advertised once per location (for example one SEO
// post per market), so the location set is part of what makes a job unique.
export function duplicateKey(
  title: string,
  departmentId: string,
  locationIds: readonly string[],
) {
  return `${matchKey(title)}|${departmentId}|${[...locationIds].sort().join(",")}`;
}

const hasContent = (language: JobDraft["en"]) =>
  !!language.title ||
  language.responsibilities.length > 0 ||
  language.requirements.length > 0;

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

// Overwrite replaces the Chinese content and the settings with the file's values.
// English is kept when the file has none, and the schedule is never imported.
// Returns undefined when the job's settings are locked and the file disagrees.
function overwriteDraft(
  incoming: JobDraft,
  existing: ExistingJob,
): JobDraft | undefined {
  const old = existing.draft.settings;
  let settings: JobDraft["settings"] = {
    ...incoming.settings,
    publishAt: old.publishAt,
    closeAt: old.closeAt,
  };
  if (existing.settingsLocked) {
    // The database compares arrays in order, so adopt the stored order when the
    // file lists the same locations.
    if (!sameSet(settings.locationIds, old.locationIds)) return undefined;
    settings = { ...settings, locationIds: old.locationIds };
    const strip = (s: JobDraft["settings"]) =>
      JSON.stringify([
        s.departmentId,
        s.jobType,
        s.experience,
        s.salary,
        s.showSalary,
      ]);
    if (strip(settings) !== strip(old)) return undefined;
  }
  const recruiting = { ...existing.draft.recruiting, ...incoming.recruiting };
  return {
    zh: incoming.zh,
    en: hasContent(incoming.en) ? incoming.en : existing.draft.en,
    settings,
    ...(Object.keys(recruiting).length ? { recruiting } : {}),
  };
}

export function validateImportRows(
  rows: readonly ImportRowInput[],
  refs: ImportRefs,
  existingJobs: readonly ExistingJob[],
  decisions: ImportDecisions = noDecisions,
): ImportValidation {
  const results: ImportRowResult[] = [];
  const plan: ImportPlanItem[] = [];
  const firstRowForKey = new Map<string, number>();
  const open = new Map<string, ExistingJob[]>();
  const titleOf = (job: ExistingJob) =>
    job.draft.zh.title || job.draft.en.title;
  // Closed is terminal, so a closed posting never blocks a repost.
  for (const job of existingJobs) {
    if (job.status === "CLOSED" || !job.draft.settings.departmentId) continue;
    const key = duplicateKey(
      titleOf(job),
      job.draft.settings.departmentId,
      job.draft.settings.locationIds,
    );
    open.set(key, [...(open.get(key) ?? []), job]);
  }
  const summary = {
    total: rows.length,
    create: 0,
    overwrite: 0,
    skipped: 0,
    errors: 0,
    undecided: 0,
  };
  for (const input of rows) {
    const built = buildRow(input, refs);
    const result: ImportRowResult = {
      row: input.row,
      status: "ok",
      issues: built.issues,
    };
    if (built.key) {
      const earlier = firstRowForKey.get(built.key);
      if (earlier === undefined) firstRowForKey.set(built.key, input.row);
      else
        result.issues.push({
          column: null,
          code: "duplicate_in_file",
          otherRow: earlier,
        });
    }
    const matches = built.key ? (open.get(built.key) ?? []) : [];
    if (matches.length) {
      const target = matches[0];
      result.duplicate = {
        id: target.id,
        version: target.version,
        status: target.status,
      };
    }
    if (result.issues.length || !built.draft) {
      result.status = "error";
      summary.errors++;
    } else if (!matches.length) {
      result.action = "create";
      summary.create++;
      plan.push({ row: input.row, action: "create", draft: built.draft });
    } else {
      const choice = decisions.perRow[input.row] ?? decisions.default;
      if (!choice) {
        result.status = "duplicate";
        summary.undecided++;
      } else if (choice === "skip") {
        result.status = "skipped";
        result.action = "skip";
        summary.skipped++;
      } else if (matches.length > 1) {
        result.issues.push({ column: null, code: "ambiguous_duplicate" });
        result.status = "error";
        summary.errors++;
      } else {
        const merged = overwriteDraft(built.draft, matches[0]);
        if (!merged) {
          result.issues.push({ column: null, code: "settings_locked" });
          result.status = "error";
          summary.errors++;
        } else {
          result.action = "overwrite";
          summary.overwrite++;
          plan.push({
            row: input.row,
            action: "overwrite",
            draft: merged,
            existingId: matches[0].id,
            existingVersion: matches[0].version,
          });
        }
      }
    }
    results.push(result);
  }
  return {
    rows: results,
    plan,
    summary,
    canConfirm:
      rows.length > 0 &&
      summary.errors === 0 &&
      summary.undecided === 0 &&
      plan.length > 0,
  };
}
