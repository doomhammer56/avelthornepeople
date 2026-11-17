import { parsePublicJob, parsePublicJobs } from "../../lib/publicJobSchema.ts";

// Approved content shape: {en:{title,responsibilities,requirements},zh:{...}}.
// Every public field is selected explicitly; never spread published JSON.
export type PublicJobRow = {
  id: string;
  canonical_slug: string;
  published_content: {
    en?: Record<string, unknown>;
    zh?: Record<string, unknown>;
    englishFallback?: boolean;
  };
  publish_at: Date;
  close_at: Date | null;
  department_en: string | null;
  department_zh: string;
  locations: { en: string | null; zh: string }[];
  job_type: string;
  experience: string | null;
  type_label: { en: string; zh: string } | null;
  experience_label: { en: string; zh: string } | null;
  show_salary: boolean;
  salary_min: string | null;
  salary_max: string | null;
  salary_currency: string | null;
  salary_period: string | null;
};

// Summary queries extract titles in PostgreSQL and never return the description
// document, closing date or compensation. Keep JSON title types until validation
// so a malformed numeric/object title cannot become valid text through SQL casts.
export type PublicJobSummaryRow = Pick<
  PublicJobRow,
  | "id"
  | "canonical_slug"
  | "publish_at"
  | "close_at"
  | "department_en"
  | "department_zh"
  | "locations"
  | "type_label"
  | "experience_label"
> & {
  title_en: unknown;
  title_zh: unknown;
  english_fallback: boolean;
};

function summaryFields(row: PublicJobSummaryRow) {
  const chineseFallback = row.english_fallback === true;
  const englishFallback =
    !chineseFallback &&
    typeof row.title_zh === "string" &&
    !row.title_zh.trim() &&
    typeof row.title_en === "string" &&
    !!row.title_en.trim();
  return {
    id: row.id,
    slug: row.canonical_slug,
    title: {
      en: chineseFallback ? row.title_zh : row.title_en,
      zh: englishFallback ? row.title_en : row.title_zh,
    },
    ...(chineseFallback
      ? { contentLanguage: "zh" }
      : englishFallback
        ? { contentLanguage: "en" }
        : {}),
    department: {
      en: row.department_en || (chineseFallback ? row.department_zh : null),
      zh: row.department_zh,
    },
    location: {
      en: row.locations.every((location) => location.en || chineseFallback)
        ? row.locations.map((location) => location.en || location.zh).join(", ")
        : "",
      zh: row.locations.map((location) => location.zh).join("、"),
    },
    type: row.type_label,
    experience: row.experience_label,
    postedAt: new Date(row.publish_at).toISOString().slice(0, 10),
    closesAt: row.close_at
      ? new Date(row.close_at).toISOString().slice(0, 10)
      : null,
  };
}

export function publicJobSummaryDtos(rows: PublicJobSummaryRow[]) {
  // Validate once at the collection boundary, including duplicate IDs/slugs.
  return parsePublicJobs({ jobs: rows.map(summaryFields) });
}

const periods: Record<string, { en: string; zh: string }> = {
  HOUR: { en: "Hour", zh: "小时" },
  DAY: { en: "Day", zh: "天" },
  MONTH: { en: "Month", zh: "月" },
  YEAR: { en: "Year", zh: "年" },
};

export function publicJobDto(row: PublicJobRow) {
  const content = row.published_content;
  const cleanLines = (value: unknown) =>
    Array.isArray(value)
      ? value
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter(Boolean)
      : [];
  const summary = summaryFields({
    ...row,
    title_en: content.en?.title,
    title_zh: content.zh?.title,
    english_fallback: content.englishFallback === true,
  });
  const chineseFallback = summary.contentLanguage === "zh";
  const englishFallback = summary.contentLanguage === "en";
  const en = chineseFallback ? content.zh : content.en;
  const zh = englishFallback ? content.en : content.zh;
  return parsePublicJob({
    job: {
      ...summary,
      employmentType:
        (
          {
            FULL_TIME: "FULL_TIME",
            PART_TIME: "PART_TIME",
            CONTRACT: "CONTRACTOR",
            INTERNSHIP: "INTERN",
            INTERN: "INTERN",
            TEMPORARY: "TEMPORARY",
          } as Record<string, string>
        )[row.job_type] ?? "OTHER",
      closesAt: row.close_at ? new Date(row.close_at).toISOString() : null,
      status: "open",
      responsibilities: {
        en: cleanLines(en?.responsibilities),
        zh: cleanLines(zh?.responsibilities),
      },
      requirements: {
        en: cleanLines(en?.requirements),
        zh: cleanLines(zh?.requirements),
      },
      showSalary: row.show_salary,
      ...(row.show_salary
        ? {
            salary: {
              min: row.salary_min === null ? undefined : Number(row.salary_min),
              max: row.salary_max === null ? undefined : Number(row.salary_max),
              currency: row.salary_currency,
              period: periods[row.salary_period ?? ""],
              periodCode: row.salary_period,
            },
          }
        : {}),
    },
  });
}
