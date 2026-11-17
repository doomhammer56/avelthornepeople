import type { JobDraft } from "../../server/jobs/management-contract.ts";
import type { JobIssue } from "./jobValidation.ts";
import {
  scheduleInstant,
  ScheduleTimeError,
  zonedDateTime,
} from "./timeZone.ts";
export type SalaryInputs = { min: string; max: string };
export type ScheduleInputs = { publishAt: string; closeAt: string };
export type ScheduleInstants = Pick<
  JobDraft["settings"],
  "publishAt" | "closeAt"
>;
export function rezoneSchedule(
  values: ScheduleInputs,
  from: string,
  to: string,
  original: ScheduleInstants,
) {
  if (from === to)
    return { values, timeZone: to, original, issues: [] as JobIssue[] };
  const result = { ...values };
  const issues: JobIssue[] = [];
  const instants = { ...original };
  for (const field of ["publishAt", "closeAt"] as const) {
    try {
      instants[field] = scheduleInstant(values[field], from, original[field]);
      result[field] = zonedDateTime(instants[field], to);
    } catch (error) {
      issues.push({
        field: `draft.settings.${field}`,
        code: error instanceof ScheduleTimeError ? error.code : "invalid",
      });
    }
  }
  return {
    values: issues.length ? values : result,
    timeZone: issues.length ? from : to,
    original: issues.length ? original : instants,
    issues,
  };
}
export function jobEditorInput(
  draft: JobDraft,
  salary: SalaryInputs,
  schedule: ScheduleInputs,
  timeZone = "UTC",
  original: ScheduleInstants = draft.settings,
): { draft: JobDraft; issues: JobIssue[] } {
  const settings = { ...draft.settings };
  const issues: JobIssue[] = [];
  if (settings.salary) {
    const amounts = { min: 0, max: 0 };
    for (const key of ["min", "max"] as const) {
      const raw = salary[key].trim(),
        field = `draft.settings.salary.${key}`;
      if (!raw) issues.push({ field, code: "required" });
      else if (!/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw)))
        issues.push({ field, code: "invalid" });
      else if ((raw.split(".")[1]?.length ?? 0) > 2)
        issues.push({ field, code: "precision" });
      else amounts[key] = Number(raw);
    }
    settings.salary = { ...settings.salary, ...amounts };
  }
  for (const key of ["publishAt", "closeAt"] as const) {
    const raw = schedule[key];
    if (!raw) settings[key] = null;
    else {
      try {
        settings[key] = scheduleInstant(raw, timeZone, original[key]);
      } catch (error) {
        issues.push({
          field: `draft.settings.${key}`,
          code: error instanceof ScheduleTimeError ? error.code : "invalid",
        });
      }
    }
  }
  return { draft: { ...draft, settings }, issues };
}
