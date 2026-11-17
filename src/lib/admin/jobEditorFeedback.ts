import { jobEditorContent } from "./jobEditorContent.ts";
import { jobManagementContent } from "./jobManagementContent.ts";
import { jobValidationContent, type JobIssue } from "./jobValidation.ts";

export function jobIssueMessage(issue: JobIssue, lang: "en" | "zh") {
  const t = jobEditorContent[lang],
    m = jobManagementContent[lang];
  const labels: Record<string, string> = {
    title: t.titleLabel,
    responsibilities: t.duties,
    requirements: t.requirements,
    departmentId: t.department,
    locationIds: t.location,
    jobType: t.type,
    experience: t.experience,
    salary: t.salaryRange,
    min: m.minimum,
    max: m.maximum,
    currency: m.currency,
    period: m.period,
    showSalary: t.showSalary,
    publishAt: t.postedDate,
    closeAt: t.closingDate,
    slug: m.slug,
  };
  const parts = issue.field.split(".");
  const language =
    parts[1] === "en" ? "English" : parts[1] === "zh" ? "中文" : "";
  const label = labels[parts.at(-1) ?? ""];
  const prefix = [language, label].filter(Boolean).join(" — ");
  return `${prefix ? `${prefix}: ` : ""}${jobValidationContent[lang][issue.code]}`;
}
