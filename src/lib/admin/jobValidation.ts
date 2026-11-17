// Shared safe error vocabulary. No rejected values or database messages cross it.
export const jobIssueCodes = [
  "required",
  "invalid",
  "too_long",
  "too_many",
  "invalid_range",
  "precision",
  "inactive",
  "expired",
  "fallback_required",
  "language_required",
  "ambiguous_time",
  "nonexistent_time",
  "locked",
] as const;
export type JobIssueCode = (typeof jobIssueCodes)[number];
export type JobIssue = { field: string; code: JobIssueCode };
const fields = new Set([
  "draft",
  "slug",
  "id",
  "requestId",
  "expectedVersion",
  "action",
  "allowChineseFallback",
  ...["en", "zh"].flatMap((lang) =>
    ["title", "responsibilities", "requirements"].map(
      (field) => `draft.${lang}.${field}`,
    ),
  ),
  ...[
    "departmentId",
    "locationIds",
    "jobType",
    "experience",
    "salary",
    "showSalary",
    "publishAt",
    "closeAt",
  ].map((field) => `draft.settings.${field}`),
  ...["min", "max", "currency", "period"].map(
    (field) => `draft.settings.salary.${field}`,
  ),
  "draft.recruiting",
  "draft.recruiting.priority",
  "draft.recruiting.gender",
]);
export function safeJobIssues(value: unknown): JobIssue[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 20)
    .flatMap((item) =>
      item && fields.has(item.field) && jobIssueCodes.includes(item.code)
        ? [{ field: item.field, code: item.code }]
        : [],
    );
}
export function jobIssueField(path: readonly PropertyKey[]) {
  const field = path.filter((p) => typeof p === "string").join(".");
  return fields.has(field)
    ? field
    : fields.has(field.replace(/\.[^.]+$/, ""))
      ? field.replace(/\.[^.]+$/, "")
      : "draft";
}
export function textareaLines(value: string) {
  return value.split(/\r\n|\r|\n/);
}
export function linesTextarea(value: readonly string[]) {
  return value.join("\n");
}

type JobLanguage = {
  title: string;
  responsibilities: readonly string[];
  requirements: readonly string[];
};
export function hasJobLanguageContent(content: JobLanguage) {
  return (
    !!content.title.trim() ||
    content.responsibilities.some((line) => !!line.trim()) ||
    content.requirements.some((line) => !!line.trim())
  );
}

// Blank translations are optional. A translation that is started must be
// complete before submission/publication; saving incomplete drafts stays valid.
export function jobPublicationIssues(draft: {
  en: JobLanguage;
  zh: JobLanguage;
  settings: { departmentId: string | null; locationIds: readonly string[] };
}): JobIssue[] {
  const issues: JobIssue[] = [];
  let languages = 0;
  for (const language of ["en", "zh"] as const) {
    const content = draft[language];
    if (!hasJobLanguageContent(content)) continue;
    languages++;
    if (!content.title.trim())
      issues.push({ field: `draft.${language}.title`, code: "required" });
    for (const field of ["responsibilities", "requirements"] as const)
      if (!content[field].some((line) => !!line.trim()))
        issues.push({ field: `draft.${language}.${field}`, code: "required" });
  }
  if (!languages) issues.push({ field: "draft", code: "language_required" });
  if (!draft.settings.departmentId)
    issues.push({ field: "draft.settings.departmentId", code: "required" });
  if (!draft.settings.locationIds.length)
    issues.push({ field: "draft.settings.locationIds", code: "required" });
  return issues;
}
export const jobValidationContent = {
  en: {
    locked:
      "These settings were saved and are read-only across all languages. Reload to see the saved values.",
    language_required:
      "Complete the title, responsibilities and requirements in English or Chinese (or both).",
    ambiguous_time:
      "This time occurs twice when clocks change. Choose another time, or clear this field and switch to UTC to enter the exact time.",
    nonexistent_time:
      "This local time does not exist because clocks move forward. Choose another time.",
    required: "This field is required.",
    invalid: "Enter a valid value.",
    too_long: "This value is too long.",
    too_many: "Too many items (maximum 50 content lines or 30 locations).",
    invalid_range: "Check the order of these values.",
    precision: "Use at most two decimal places.",
    inactive: "Choose an active reference with the required language label.",
    expired: "The closing time has already passed.",
    fallback_required:
      "Complete the English content or confirm Chinese fallback.",
  },
  zh: {
    locked:
      "这些设置已保存，所有语言版本均为只读。请重新加载以查看已保存的值。",
    language_required:
      "请完整填写英文或中文的职位标题、岗位职责和任职要求，也可同时填写两种语言。",
    ambiguous_time:
      "此时间在时钟调整时出现两次。请选择其他时间，或清空此字段后切换为 UTC 输入准确时间。",
    nonexistent_time: "由于时钟向前调整，此本地时间不存在。请选择其他时间。",
    required: "此项为必填。",
    invalid: "请输入有效值。",
    too_long: "内容过长。",
    too_many: "项目过多（最多 50 行内容或 30 个地点）。",
    invalid_range: "请检查数值或日期的先后顺序。",
    precision: "最多保留两位小数。",
    inactive: "请选择有效且具有所需语言名称的选项。",
    expired: "截止时间已过。",
    fallback_required: "请完善英文内容或确认使用中文版本。",
  },
} as const;
