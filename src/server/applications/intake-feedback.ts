import { z } from "zod";
import {
  type ApplicationIssue,
  safeApplicationIssues,
} from "../../lib/applicationFeedback.ts";

export class ApplicationInputError extends Error {
  readonly status = 400;
  readonly issues: ApplicationIssue[];
  constructor(issues: ApplicationIssue[]) {
    super("Application input invalid");
    this.issues = safeApplicationIssues(issues);
  }
}

// Return only known fields/codes, never rejected values, provider messages or SQL.
export function intakeIssues(error: unknown): ApplicationIssue[] {
  if (error instanceof ApplicationInputError) return error.issues;
  if (!(error instanceof z.ZodError)) return [];
  return error.issues.slice(0, 10).flatMap<ApplicationIssue>((issue) => {
    const field = String(issue.path[0]);
    const required =
      issue.code === "too_small" || issue.code === "invalid_type";
    const code =
      issue.code === "too_big" ? "too_long" : required ? "required" : "invalid";
    if (["name", "email", "phone", "coverLetter", "consent"].includes(field))
      return [{ field: field as ApplicationIssue["field"], code }];
    if (["fileName", "contentType", "size", "resumeToken"].includes(field))
      return [
        {
          field: "resume",
          code:
            field === "size"
              ? issue.code === "too_big"
                ? "resume_size"
                : "resume_empty"
              : field === "resumeToken"
                ? "upload_expired"
                : field === "fileName" && issue.code === "too_big"
                  ? "file_name"
                  : "resume_type",
        },
      ];
    if (field === "consentVersion")
      return [{ field: "consent", code: "invalid" }];
    return [];
  });
}
