import test from "node:test";
import assert from "node:assert/strict";
import { jobPublicationIssues } from "../../../src/lib/admin/jobValidation.ts";
import { jobIssueMessage } from "../../../src/lib/admin/jobEditorFeedback.ts";
import {
  publicJobDto,
  publicJobSummaryDtos,
} from "../../../src/server/jobs/public-dto.ts";

const blank = () => ({ title: "", responsibilities: [], requirements: [] });
const complete = () => ({
  title: "Engineer",
  responsibilities: ["Build"],
  requirements: ["Experience"],
});
const draft = () => ({
  en: complete(),
  zh: blank(),
  settings: { departmentId: "department", locationIds: ["location"] },
});

test("publication accepts English-only, Chinese-only and bilingual jobs", () => {
  for (const [en, zh] of [
    [complete(), blank()],
    [blank(), complete()],
    [complete(), complete()],
  ])
    assert.deepEqual(jobPublicationIssues({ ...draft(), en, zh }), []);
});

test("publication identifies blank jobs, partial translations and missing shared settings", () => {
  assert.deepEqual(jobPublicationIssues({ ...draft(), en: blank() }), [
    { field: "draft", code: "language_required" },
  ]);
  assert.deepEqual(
    jobPublicationIssues({ ...draft(), zh: { ...blank(), title: " 中文 " } }),
    [
      { field: "draft.zh.responsibilities", code: "required" },
      { field: "draft.zh.requirements", code: "required" },
    ],
  );
  assert.deepEqual(
    jobPublicationIssues({
      ...draft(),
      en: { title: "　", responsibilities: [" \n"], requirements: ["\t"] },
    }),
    [{ field: "draft", code: "language_required" }],
  );
  assert.deepEqual(
    jobPublicationIssues({
      ...draft(),
      settings: { departmentId: null, locationIds: [] },
    }),
    [
      { field: "draft.settings.departmentId", code: "required" },
      { field: "draft.settings.locationIds", code: "required" },
    ],
  );
});

test("error summaries name both language and field without rejected values", () => {
  assert.equal(
    jobIssueMessage({ field: "draft.en.requirements", code: "required" }, "en"),
    "English — Requirements: This field is required.",
  );
  assert.equal(
    jobIssueMessage({ field: "draft.zh.title", code: "required" }, "zh"),
    "中文 — 职位标题: 此项为必填。",
  );
  assert.match(
    jobIssueMessage(
      { field: "draft.settings.departmentId", code: "inactive" },
      "en",
    ),
    /^Department:/,
  );
  assert.match(
    jobIssueMessage({ field: "draft", code: "language_required" }, "en"),
    /English or Chinese/,
  );
});

test("English-only public summaries and details keep one source language with a labelled fallback", () => {
  const row = {
    id: "job",
    canonical_slug: "engineer",
    publish_at: new Date("2026-10-28T00:00:00Z"),
    close_at: null,
    published_content: { en: complete(), zh: blank(), englishFallback: false },
    department_en: "Engineering",
    department_zh: "工程",
    locations: [{ en: "Kigali", zh: "基加利" }],
    job_type: "FULL_TIME",
    type_label: { en: "Full-time", zh: "全职" },
    experience: "ANY",
    experience_label: { en: "Any", zh: "不限" },
    show_salary: false,
  };
  const detail = publicJobDto(row);
  assert.equal(detail.contentLanguage, "en");
  assert.equal(detail.title.zh, detail.title.en);
  assert.deepEqual(detail.responsibilities.zh, complete().responsibilities);
  assert.deepEqual(detail.requirements.zh, complete().requirements);
  const [summary] = publicJobSummaryDtos([
    { ...row, title_en: "Engineer", title_zh: "", english_fallback: false },
  ]);
  assert.equal(summary.contentLanguage, "en");
  assert.deepEqual(summary.title, detail.title);
});
