import test from "node:test";
import assert from "node:assert/strict";
import {
  publicJobDto,
  publicJobSummaryDtos,
} from "../../../src/server/jobs/public-dto.ts";
import { parsePublicJobs } from "../../../src/lib/publicJobSchema.ts";

const row = {
  id: "11111111-1111-1111-1111-111111111111",
  canonical_slug: "test-job",
  published_content: {
    en: {
      title: "Test job",
      responsibilities: ["Build"],
      requirements: ["Experience"],
    },
    zh: {
      title: "测试职位",
      responsibilities: ["开发"],
      requirements: ["经验"],
    },
    internalNotes: "must not leak",
    candidateEmail: "must not leak",
  },
  publish_at: new Date("2026-10-23T10:00:00Z"),
  close_at: null,
  department_en: "Engineering",
  department_zh: "工程",
  locations: [{ en: "Kigali", zh: "基加利" }],
  job_type: "FULL_TIME",
  type_label: { en: "Full-time", zh: "全职" },
  experience_label: { en: "Mid level", zh: "中级" },
  experience: "MID",
  show_salary: false,
  salary_min: "100",
  salary_max: "200",
  salary_currency: "USD",
  salary_period: "MONTH",
};
test("Published DTO selects approved bilingual content and strips private metadata and hidden pay", () => {
  const dto = publicJobDto(row);
  assert.equal(dto.slug, "test-job");
  assert.equal(dto.title.zh, "测试职位");
  assert.equal(dto.postedAt, "2026-10-23");
  assert.equal(dto.salary, undefined);
  assert.equal(dto.internalNotes, undefined);
  assert.equal(dto.candidateEmail, undefined);
  assert.equal(dto.published_content, undefined);
  const visible = publicJobDto({ ...row, show_salary: true });
  assert.equal(visible.salary.min, 100);
  assert.equal(visible.salary.period.en, "Month");
  assert.equal(visible.salary.periodCode, "MONTH");
});
test("Incomplete translations, missing locations, unsupported types and invalid salaries fail closed", () => {
  for (const override of [
    { department_en: null },
    { locations: [] },
    { locations: [{ en: null, zh: "地点" }] },
    { type_label: null },
    { published_content: { en: row.published_content.en } },
    { show_salary: true, salary_min: "300" },
  ])
    assert.throws(() => publicJobDto({ ...row, ...override }));
});

test("Published DTO preserves the exact database closing instant", () => {
  const dto = publicJobDto({
    ...row,
    close_at: new Date("2026-10-27T08:00:00.123Z"),
  });
  assert.equal(dto.closesAt, "2026-10-27T08:00:00.123Z");
});

function summaryRow(detail = row) {
  return {
    id: detail.id,
    canonical_slug: detail.canonical_slug,
    publish_at: detail.publish_at,
    department_en: detail.department_en,
    department_zh: detail.department_zh,
    locations: detail.locations,
    type_label: detail.type_label,
    experience_label: detail.experience_label,
    title_en: detail.published_content.en?.title,
    title_zh: detail.published_content.zh?.title,
    english_fallback: detail.published_content.englishFallback === true,
  };
}

test("Summary-only rows match the previous public contract, including Chinese fallback", () => {
  for (const detail of [
    row,
    { ...row, experience_label: null },
    {
      ...row,
      published_content: {
        ...row.published_content,
        englishFallback: true,
        en: undefined,
      },
      department_en: null,
      locations: [
        { en: null, zh: "上海" },
        { en: "Kigali", zh: "基加利" },
      ],
    },
  ]) {
    assert.deepEqual(
      publicJobSummaryDtos([summaryRow(detail)]),
      parsePublicJobs({ jobs: [publicJobDto(detail)] }),
    );
  }
});

test("Summary conversion never reads detail-only fields or emits them", () => {
  const summary = summaryRow();
  for (const field of [
    "published_content",
    "close_at",
    "salary_min",
    "salary_max",
    "show_salary",
    "internalNotes",
  ])
    Object.defineProperty(summary, field, {
      enumerable: true,
      get: () => assert.fail(`Summary accessed ${field}`),
    });
  const [dto] = publicJobSummaryDtos([summary]);
  assert.deepEqual(Object.keys(dto).sort(), [
    "department",
    "experience",
    "id",
    "location",
    "postedAt",
    "slug",
    "title",
    "type",
  ]);
});

test("Summary validation still rejects invalid titles, labels and missing translations", () => {
  for (const change of [
    { title_en: 123 },
    { title_en: { text: "Not a title" } },
    { title_en: ["Not a title"] },
    { title_zh: null },
    { title_en: " " },
    { title_en: null, english_fallback: "true" },
    { department_en: null },
    { locations: [] },
    { locations: [{ en: null, zh: "上海" }] },
    { type_label: null },
  ])
    assert.throws(() => publicJobSummaryDtos([{ ...summaryRow(), ...change }]));
});

test("Summary collection retains empty-list and duplicate-identifier safeguards", () => {
  assert.deepEqual(publicJobSummaryDtos([]), []);
  const summary = summaryRow();
  assert.throws(() => publicJobSummaryDtos([summary, summary]));
  assert.throws(() =>
    publicJobSummaryDtos([summary, { ...summary, id: "another-id" }]),
  );
  assert.throws(() =>
    publicJobSummaryDtos([
      summary,
      { ...summary, canonical_slug: "another-slug" },
    ]),
  );
});
