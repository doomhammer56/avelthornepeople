// Single source of truth for the job-import template. Adding a column means
// adding one entry here and teaching validate.ts what to do with it.
export const importColumnKeys = [
  "title_zh",
  "project",
  "location",
  "job_type",
  "experience",
  "responsibilities_zh",
  "requirements_zh",
  "salary_min",
  "salary_max",
  "salary_currency",
  "salary_period",
  "show_salary",
  "title_en",
  "responsibilities_en",
  "requirements_en",
  "priority",
  "gender",
  "nationality_zh",
  "nationality_en",
  "age_zh",
  "age_en",
  "languages_zh",
  "languages_en",
  "working_hours_zh",
  "working_hours_en",
  "salary_note_zh",
  "salary_note_en",
  "work_arrangement_zh",
  "work_arrangement_en",
  "other_zh",
  "other_en",
  "benefits_zh",
  "benefits_en",
  "precautions_zh",
  "precautions_en",
  "hard_requirements_zh",
  "hard_requirements_en",
  "remark_zh",
  "remark_en",
] as const;
export type ImportColumnKey = (typeof importColumnKeys)[number];

export type ImportColumn = {
  key: ImportColumnKey;
  label: { zh: string; en: string };
  // The template cannot be used if a required column is missing. Blank required
  // cells are reported per row by the validator.
  required: boolean;
  width: number;
  note: { zh: string; en: string };
};

// Staff-only recruiting details. Each text field is stored as { zh, en } under
// draft.recruiting.<field>; priority and gender are fixed choices.
export const recruitingNoteFields = [
  {
    field: "nationality",
    column: "nationality",
    label: { zh: "国籍要求", en: "Nationality requirement" },
    note: { zh: "自由文本，仅内部可见", en: "Free text, staff only" },
  },
  {
    field: "age",
    column: "age",
    label: { zh: "年龄要求", en: "Age requirement" },
    note: { zh: "自由文本，如 25-35 岁", en: "Free text, e.g. 25-35" },
  },
  {
    field: "languages",
    column: "languages",
    label: { zh: "语言要求", en: "Language requirement" },
    note: { zh: "自由文本", en: "Free text" },
  },
  {
    field: "workingHours",
    column: "working_hours",
    label: { zh: "上班时间", en: "Working hours" },
    note: { zh: "自由文本", en: "Free text" },
  },
  {
    field: "salaryNote",
    column: "salary_note",
    label: { zh: "薪资待遇说明", en: "Salary note" },
    note: {
      zh: "原样保存的薪资文字，不对外显示",
      en: "Salary wording kept as written; not shown publicly",
    },
  },
  {
    field: "workArrangement",
    column: "work_arrangement",
    label: { zh: "工作安排", en: "Work arrangement" },
    note: { zh: "如居家办公、出差要求", en: "e.g. remote work, travel" },
  },
  {
    field: "other",
    column: "other",
    label: { zh: "其他", en: "Other" },
    note: { zh: "自由文本", en: "Free text" },
  },
  {
    field: "benefits",
    column: "benefits",
    label: { zh: "福利制度", en: "Benefits" },
    note: { zh: "自由文本", en: "Free text" },
  },
  {
    field: "precautions",
    column: "precautions",
    label: { zh: "注意事项", en: "Precautions" },
    note: { zh: "自由文本", en: "Free text" },
  },
  {
    field: "hardRequirements",
    column: "hard_requirements",
    label: { zh: "硬性条件", en: "Hard requirements" },
    note: { zh: "自由文本", en: "Free text" },
  },
  {
    field: "remark",
    column: "remark",
    label: { zh: "备注", en: "Remark" },
    note: { zh: "自由文本", en: "Free text" },
  },
] as const;
export const recruitingTextLimit = 4000;

export const priorityOptions = [
  { code: "URGENT", zh: "紧急", en: "Urgent", aliases: ["緊急", "紧急", "急"] },
  { code: "HIGH", zh: "高", en: "High", aliases: [] },
  { code: "MEDIUM", zh: "中", en: "Medium", aliases: ["middle", "normal"] },
  { code: "LOW", zh: "低", en: "Low", aliases: [] },
] as const;
export const genderOptions = [
  {
    code: "ANY",
    zh: "不限",
    en: "No limit",
    aliases: ["any", "none", "无限制", "無限制"],
  },
  {
    code: "FEMALE_PREFERRED",
    zh: "女性优先",
    en: "Women first",
    aliases: ["女性優先", "女优先", "female preferred"],
  },
  {
    code: "MALE_PREFERRED",
    zh: "男性优先",
    en: "Men first",
    aliases: ["男性優先", "男优先", "male preferred"],
  },
  {
    code: "FEMALE",
    zh: "仅限女性",
    en: "Women only",
    aliases: ["女", "女性", "仅女性", "僅限女性", "female"],
  },
  {
    code: "MALE",
    zh: "仅限男性",
    en: "Men only",
    aliases: ["男", "男性", "仅男性", "僅限男性", "male"],
  },
] as const;

export const importColumns: readonly ImportColumn[] = [
  {
    key: "title_zh",
    label: { zh: "岗位名称", en: "Job title" },
    required: true,
    width: 28,
    note: { zh: "中文职位标题", en: "Chinese job title" },
  },
  {
    key: "project",
    label: { zh: "项目", en: "Project" },
    required: true,
    width: 22,
    note: {
      zh: "须与系统中的部门一致（见 Reference 工作表）",
      en: "Must match a department (see the Reference sheet)",
    },
  },
  {
    key: "location",
    label: { zh: "上班地点", en: "Location" },
    required: true,
    width: 22,
    note: {
      zh: "须与系统中的地点一致；多个地点用逗号分隔",
      en: "Must match a location; separate several with commas",
    },
  },
  {
    key: "job_type",
    label: { zh: "职位类型", en: "Job type" },
    required: false,
    width: 16,
    note: { zh: "留空表示全职", en: "Blank means full-time" },
  },
  {
    key: "experience",
    label: { zh: "经验要求", en: "Experience" },
    required: false,
    width: 16,
    note: { zh: "留空表示经验不限", en: "Blank means any experience" },
  },
  {
    key: "responsibilities_zh",
    label: { zh: "工作职责", en: "Responsibilities" },
    required: true,
    width: 50,
    note: { zh: "每行一项", en: "One item per line" },
  },
  {
    key: "requirements_zh",
    label: { zh: "任职资格", en: "Requirements" },
    required: true,
    width: 50,
    note: { zh: "每行一项", en: "One item per line" },
  },
  {
    key: "salary_min",
    label: { zh: "最低薪资", en: "Salary min" },
    required: false,
    width: 14,
    note: {
      zh: "薪资四列须同时填写或同时留空",
      en: "Fill all four salary columns or none",
    },
  },
  {
    key: "salary_max",
    label: { zh: "最高薪资", en: "Salary max" },
    required: false,
    width: 14,
    note: { zh: "不得低于最低薪资", en: "Not below the minimum" },
  },
  {
    key: "salary_currency",
    label: { zh: "币种", en: "Currency" },
    required: false,
    width: 12,
    note: { zh: "三位字母，如 USD", en: "Three letters, e.g. USD" },
  },
  {
    key: "salary_period",
    label: { zh: "薪资周期", en: "Salary period" },
    required: false,
    width: 14,
    note: { zh: "时 / 日 / 月 / 年", en: "Hour / Day / Month / Year" },
  },
  {
    key: "show_salary",
    label: { zh: "显示薪资", en: "Show salary" },
    required: false,
    width: 12,
    note: { zh: "是 / 否；留空为否", en: "Yes / No; blank is No" },
  },
  {
    key: "title_en",
    label: { zh: "英文标题", en: "English title" },
    required: false,
    width: 28,
    note: {
      zh: "英文三列须同时填写或同时留空",
      en: "Fill all three English columns or none",
    },
  },
  {
    key: "responsibilities_en",
    label: { zh: "英文职责", en: "English responsibilities" },
    required: false,
    width: 50,
    note: { zh: "每行一项", en: "One item per line" },
  },
  {
    key: "requirements_en",
    label: { zh: "英文要求", en: "English requirements" },
    required: false,
    width: 50,
    note: { zh: "每行一项", en: "One item per line" },
  },
  {
    key: "priority",
    label: { zh: "优先级", en: "Priority" },
    required: false,
    width: 12,
    note: { zh: "紧急 / 高 / 中 / 低", en: "Urgent / High / Medium / Low" },
  },
  {
    key: "gender",
    label: { zh: "性别要求", en: "Gender requirement" },
    required: false,
    width: 16,
    note: {
      zh: "不限 / 女性优先 / 男性优先 / 仅限女性 / 仅限男性",
      en: "No limit / Women first / Men first / Women only / Men only",
    },
  },
  ...recruitingNoteFields.flatMap((field) =>
    (["zh", "en"] as const).map((language) => ({
      key: `${field.column}_${language}` as ImportColumnKey,
      label: {
        zh: `${field.label.zh}（${language === "zh" ? "中文" : "英文"}）`,
        en: `${field.label.en} (${language === "zh" ? "Chinese" : "English"})`,
      },
      required: false,
      width: 30,
      note: field.note,
    })),
  ),
];

export const importColumnByKey = Object.fromEntries(
  importColumns.map((column) => [column.key, column]),
) as Record<ImportColumnKey, ImportColumn>;

export const importTemplate = {
  id: "tricore-job-import",
  version: 1,
} as const;
export const importLimits = {
  maxRows: 200,
  maxFileBytes: 2 * 1024 * 1024,
  maxCellChars: 110_000,
  maxFileNameChars: 255,
} as const;

export const salaryPeriodAliases: Record<
  string,
  "HOUR" | "DAY" | "MONTH" | "YEAR"
> = {
  hour: "HOUR",
  hourly: "HOUR",
  时: "HOUR",
  小时: "HOUR",
  day: "DAY",
  daily: "DAY",
  日: "DAY",
  天: "DAY",
  month: "MONTH",
  monthly: "MONTH",
  月: "MONTH",
  year: "YEAR",
  yearly: "YEAR",
  annual: "YEAR",
  年: "YEAR",
};

// Matches how HR actually types headers: with or without the required marker,
// in either language, or as "中文 / English".
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[*＊]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function headerLabel(column: ImportColumn): string {
  return `${column.label.zh} / ${column.label.en}${column.required ? " *" : ""}`;
}

const headerLookup = new Map<string, ImportColumnKey>();
for (const column of importColumns) {
  for (const alias of [
    column.key,
    column.label.zh,
    column.label.en,
    `${column.label.zh} / ${column.label.en}`,
    `${column.label.zh}/${column.label.en}`,
  ])
    headerLookup.set(normalizeHeader(alias), column.key);
}
export function columnForHeader(value: string): ImportColumnKey | undefined {
  return headerLookup.get(normalizeHeader(value));
}
