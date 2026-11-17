import type { ApplicationContent } from "./applicationContent.ts";

export const applicationFields = [
  "name",
  "email",
  "phone",
  "coverLetter",
  "resume",
  "consent",
] as const;
export type ApplicationField = (typeof applicationFields)[number];
const issueCodes = [
  "required",
  "invalid",
  "too_long",
  "resume_type",
  "resume_size",
  "resume_empty",
  "resume_invalid",
  "file_name",
  "upload_expired",
] as const;
export type ApplicationIssue = {
  field: ApplicationField;
  code: (typeof issueCodes)[number];
};
export function safeApplicationIssues(value: unknown): ApplicationIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 10)
    .flatMap((item) =>
      item &&
      applicationFields.includes(item.field) &&
      issueCodes.includes(item.code)
        ? [{ field: item.field, code: item.code }]
        : [],
    );
}

export function applicationIssueMessage(
  issue: ApplicationIssue,
  t: ApplicationContent,
) {
  const v = t.validation;
  if (issue.field === "resume") {
    switch (issue.code) {
      case "required":
        return v.resumeRequired;
      case "resume_type":
        return v.resumeType;
      case "resume_size":
        return v.resumeSize;
      case "resume_empty":
        return v.resumeEmpty;
      case "file_name":
        return v.resumeName;
      case "upload_expired":
        return v.uploadExpired;
      default:
        return v.resumeInvalid;
    }
  }
  if (issue.field === "consent") return v.consent;
  if (issue.field === "phone")
    return issue.code === "required" ? v.phoneRequired : v.phone;
  if (issue.field === "email")
    return issue.code === "required" ? v.emailRequired : v.email;
  if (issue.field === "coverLetter") return v.coverLetterLength;
  return issue.code === "too_long" ? v.nameLength : v.nameRequired;
}

export type ApplicationFailureCode =
  | "validation"
  | "upload"
  | "rateLimited"
  | "forbidden"
  | "conflict"
  | "unavailable"
  | "network"
  | "timeout"
  | "unconfirmed"
  | "closed"
  | "invalidRequest"
  | "captcha";
export class ApplicationSubmissionError extends Error {
  readonly code: ApplicationFailureCode;
  readonly issues: ApplicationIssue[];
  readonly retryAfterSeconds?: number;
  constructor(
    code: ApplicationFailureCode,
    issues: ApplicationIssue[] = [],
    retryAfterSeconds?: number,
  ) {
    super(`Application submission: ${code}`);
    this.code = code;
    this.issues = safeApplicationIssues(issues);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
