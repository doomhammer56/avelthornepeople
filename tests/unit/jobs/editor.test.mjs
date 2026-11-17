import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  jobDraftSchema,
  saveJobSchema,
} from "../../../src/server/jobs/management-contract.ts";
import { jobEditorInput } from "../../../src/lib/admin/jobEditorInput.ts";
import {
  textareaLines,
  linesTextarea,
  safeJobIssues,
} from "../../../src/lib/admin/jobValidation.ts";
import {
  zodJobError,
  databaseJobError,
} from "../../../src/server/jobs/validation.ts";
import { sendJobCommand } from "../../../src/lib/admin/jobClient.ts";
import { adminJobDto } from "../../../src/server/admin/dto.ts";

const draft = () => ({
  en: { title: " EN ", responsibilities: ["English"], requirements: ["Skill"] },
  zh: {
    title: "　中文职位　",
    responsibilities: ["　职责一　", "", "\t", "职责  二", "职责  二"],
    requirements: [" 条件 "],
  },
  settings: {
    departmentId: randomUUID(),
    locationIds: [randomUUID()],
    jobType: "FULL_TIME",
    experience: "ANY",
    salary: null,
    showSalary: false,
    publishAt: null,
    closeAt: null,
  },
});
test("Editor normalizes Chinese/full-width whitespace and blank lines while preserving language, order and duplicate lines", () => {
  const input = draft(),
    result = jobDraftSchema.parse(input);
  assert.equal(result.zh.title, "中文职位");
  assert.deepEqual(result.zh.responsibilities, [
    "职责一",
    "职责  二",
    "职责  二",
  ]);
  assert.equal(result.en.title, "EN");
  assert.deepEqual(result.en.requirements, ["Skill"]);
  assert.equal(input.zh.title, "　中文职位　");
  assert.deepEqual(textareaLines("一\r\n二\r三\n"), ["一", "二", "三", ""]);
  assert.equal(linesTextarea(["一", "二"]), "一\n二");
});
test("Raw blank lines and overlong whitespace cannot bypass content limits", () => {
  for (const lines of [Array(51).fill(""), [" ".repeat(2001)]]) {
    const value = draft();
    value.zh.requirements = lines;
    assert.ok(!jobDraftSchema.safeParse(value).success);
  }
  const value = draft();
  value.zh.title = " ".repeat(201);
  assert.ok(!jobDraftSchema.safeParse(value).success);
});
test("Salary supports explicit zero and decimal boundary values; rejects precision, incomplete or hidden invalid ranges", () => {
  for (const amount of [0, 0.01, 1.23, 999999999999.99]) {
    const value = draft();
    value.settings.salary = {
      min: amount,
      max: amount,
      currency: "USD",
      period: "MONTH",
    };
    assert.ok(jobDraftSchema.safeParse(value).success, String(amount));
  }
  for (const salary of [
    { min: 0.001, max: 2 },
    { min: 2, max: 1 },
    { min: -1, max: 0 },
    { min: 0, max: 1000000000000 },
    { min: 0, max: Infinity },
  ]) {
    const value = draft();
    value.settings.salary = { currency: "USD", period: "MONTH", ...salary };
    assert.ok(!jobDraftSchema.safeParse(value).success);
  }
  const value = draft();
  value.settings.salary = { min: 0, max: 0, currency: "USD", period: "MONTH" };
  assert.deepEqual(
    jobEditorInput(value, { min: "", max: "0" }, { publishAt: "", closeAt: "" })
      .issues,
    [{ field: "draft.settings.salary.min", code: "required" }],
  );
  assert.equal(
    jobEditorInput(
      value,
      { min: "0", max: "0" },
      { publishAt: "", closeAt: "" },
    ).draft.settings.salary.min,
    0,
  );
  assert.equal(
    jobEditorInput(
      value,
      { min: "1.001", max: "3" },
      { publishAt: "", closeAt: "" },
    ).issues[0].code,
    "precision",
  );
});
test("Offset-aware dates normalize to UTC and invalid/equal/reversed schedules identify the closing field", () => {
  const value = draft();
  value.settings.publishAt = "2026-10-26T10:00:00+02:00";
  value.settings.closeAt = "2026-10-26T09:00:00Z";
  assert.equal(
    jobDraftSchema.parse(value).settings.publishAt,
    "2026-10-26T08:00:00.000Z",
  );
  for (const close of ["2026-10-26T08:00:00Z", "2026-10-26T07:00:00Z"]) {
    value.settings.closeAt = close;
    const error = saveJobSchema.safeParse({
      draft: value,
      slug: "safe",
      expectedVersion: 1,
      requestId: randomUUID(),
    }).error;
    assert.ok(
      zodJobError(error).issues.some(
        (i) =>
          i.field === "draft.settings.closeAt" && i.code === "invalid_range",
      ),
    );
  }
  value.settings.publishAt = "2026-02-30T10:00:00Z";
  assert.ok(!jobDraftSchema.safeParse(value).success);
  const input = jobEditorInput(
    draft(),
    { min: "", max: "" },
    { publishAt: "bad-date", closeAt: "" },
  );
  assert.equal(input.issues[0].field, "draft.settings.publishAt");
  assert.equal(
    jobEditorInput(
      draft(),
      { min: "", max: "" },
      { publishAt: "2026-02-30T10:00", closeAt: "" },
    ).issues[0].code,
    "invalid",
  );
});
test("Validation feedback is allowlisted and bounded; SQL errors/rejected values never pass to the client", async () => {
  const value = draft();
  value.settings.salary = { min: 1, max: 0, currency: "USD", period: "MONTH" };
  const error = saveJobSchema.safeParse({
    draft: value,
    slug: "safe",
    expectedVersion: 1,
    requestId: randomUUID(),
  }).error;
  assert.deepEqual(zodJobError(error).issues, [
    { field: "draft.settings.salary.max", code: "invalid_range" },
  ]);
  assert.equal(
    databaseJobError({ code: "22023", detail: "secret SQL content" }),
    undefined,
  );
  assert.deepEqual(
    safeJobIssues([
      { field: "private.table.password", code: "required" },
      { field: "draft.zh.title", code: "required", value: "secret" },
    ]),
    [{ field: "draft.zh.title", code: "required" }],
  );
  await assert.rejects(
    sendJobCommand("/api/admin/jobs/id", "PATCH", {}, async () =>
      Response.json(
        {
          error: "validation_failed",
          issues: [
            { field: "draft.zh.title", code: "required", value: "secret" },
          ],
        },
        { status: 400 },
      ),
    ),
    (error) => {
      assert.equal(error.status, 400);
      assert.deepEqual(error.issues, [
        { field: "draft.zh.title", code: "required" },
      ]);
      assert.ok(!JSON.stringify(error).includes("secret"));
      return true;
    },
  );
});
test("Approved fallback choice is exposed independently of draft content", () => {
  const value = draft();
  const job = adminJobDto({
    id: randomUUID(),
    canonical_slug: "safe",
    status: "PUBLISHED",
    draft_content: value,
    published_content: { ...value, englishFallback: true },
    version: 1,
    created_at: new Date(),
    location_ids: [],
  });
  assert.equal(job.approvedChineseFallback, true);
  assert.equal(job.draft.en.title, value.en.title);
  assert.equal(job.hasUnpublishedChanges, false);
});
