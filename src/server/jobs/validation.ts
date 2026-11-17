import { z } from "zod";
import {
  jobIssueField,
  safeJobIssues,
  type JobIssue,
} from "../../lib/admin/jobValidation.ts";

export class JobValidationError extends Error {
  readonly issues: JobIssue[];
  constructor(issues: JobIssue[]) {
    super("Job validation failed");
    this.issues = safeJobIssues(issues);
  }
}
export function zodJobError(error: z.ZodError) {
  return new JobValidationError(
    error.issues.map((issue) => ({
      field: jobIssueField(issue.path),
      code:
        issue.message === "invalid_range"
          ? "invalid_range"
          : issue.message === "required"
            ? "required"
            : issue.code === "too_big"
              ? issue.origin === "array"
                ? "too_many"
                : "too_long"
              : issue.code === "not_multiple_of"
                ? "precision"
                : "invalid",
    })),
  );
}
export function databaseJobError(error: unknown) {
  if (
    !error ||
    typeof error !== "object" ||
    !("code" in error) ||
    error.code !== "22023" ||
    !("detail" in error) ||
    typeof error.detail !== "string" ||
    error.detail.length > 4000
  )
    return undefined;
  try {
    const issues = safeJobIssues(JSON.parse(error.detail));
    return issues.length ? new JobValidationError(issues) : undefined;
  } catch {
    return undefined;
  }
}
