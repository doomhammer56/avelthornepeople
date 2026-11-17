import test from "node:test";
import assert from "node:assert/strict";
import {
  adminJobDto,
  adminJobSummaryDto,
} from "../../../src/server/admin/dto.ts";

const content = {
  en: {
    title: "Support",
    responsibilities: ["Private long description ".repeat(1000)],
    requirements: ["Experience"],
  },
  zh: {
    title: "Support ZH",
    responsibilities: ["Help"],
    requirements: ["Experience"],
  },
  settings: {
    departmentId: null,
    locationIds: [],
    jobType: "FULL_TIME",
    experience: "ANY",
    salary: null,
    showSalary: false,
    publishAt: null,
    closeAt: null,
  },
};
const row = {
  id: "11111111-1111-1111-1111-111111111111",
  status: "PUBLISHED",
  draft_content: content,
  published_content: structuredClone(content),
  created_at: "2026-10-28T00:00:00Z",
  close_at: "2026-10-29T10:20:30.123Z",
  location_ids: [],
  live: true,
  applications: "5",
  version: 4,
};

test("cached Jobs summaries omit drafts, descriptions, salary and editing fields while preserving table values", () => {
  const summary = adminJobSummaryDto(row),
    full = adminJobDto(row);
  assert.deepEqual(
    Object.keys(summary).sort(),
    [
      "id",
      "title",
      "department",
      "location",
      "locationIds",
      "type",
      "status",
      "live",
      "closeAt",
      "closesAt",
      "applications",
      "hasUnpublishedChanges",
      "version",
    ].sort(),
  );
  for (const key of Object.keys(summary))
    assert.deepEqual(summary[key], full[key]);
  assert.equal(summary.closeAt, "2026-10-29T10:20:30.123Z");
  assert.ok(!JSON.stringify(summary).includes("Private long description"));
  assert.ok(
    Buffer.byteLength(JSON.stringify(summary)) <
      Buffer.byteLength(JSON.stringify(full)) / 10,
  );
  assert.equal(
    adminJobSummaryDto({ ...row, applications: null }).applications,
    null,
  );
});

test("summary change flags preserve edits, settings changes, normalized timestamps and reversions", () => {
  const changed = structuredClone(content);
  changed.en.title = "Changed";
  const changedSettings = structuredClone(content);
  changedSettings.settings.jobType = "PART_TIME";
  const dated = structuredClone(content),
    published = structuredClone(content);
  dated.settings.publishAt = "2026-10-28T02:00:00+02:00";
  published.settings.publishAt = "2026-10-28T00:00:00Z";
  for (const value of [
    row,
    { ...row, draft_content: changed },
    { ...row, draft_content: changedSettings },
    { ...row, draft_content: dated, published_content: published },
    { ...row, version: 100 },
  ])
    assert.equal(
      adminJobSummaryDto(value).hasUnpublishedChanges,
      adminJobDto(value).hasUnpublishedChanges,
    );
  assert.equal(
    adminJobSummaryDto({ ...row, draft_content: changed })
      .hasUnpublishedChanges,
    true,
  );
  assert.equal(
    adminJobSummaryDto({
      ...row,
      draft_content: structuredClone(content),
      version: 100,
    }).hasUnpublishedChanges,
    false,
  );
});
