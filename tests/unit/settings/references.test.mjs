import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { referenceCommand } from "../../../src/server/settings/contract.ts";
import { can } from "../../../src/lib/auth/permissions.ts";
import { jobDraftSchema } from "../../../src/server/jobs/management-contract.ts";
test("All four settings categories enforce bilingual names, bounded codes and location time zones", () => {
  const base = {
    id: randomUUID(),
    requestId: randomUUID(),
    expectedVersion: 0,
    value: { code: "NEW_OPTION", nameEn: "New", nameZh: "新增", active: true },
  };
  for (const category of ["department", "jobType", "experience"]) {
    assert.ok(referenceCommand.safeParse({ ...base, category }).success);
    for (const value of [
      { ...base.value, nameEn: "" },
      { ...base.value, code: "bad code" },
      { ...base.value, extra: true },
    ])
      assert.equal(
        referenceCommand.safeParse({ ...base, category, value }).success,
        false,
      );
  }
  const location = {
    ...base,
    category: "location",
    value: { ...base.value, countryCode: "MY", timeZone: "Asia/Kuala_Lumpur" },
  };
  assert.ok(referenceCommand.safeParse(location).success);
  assert.equal(
    referenceCommand.safeParse({
      ...location,
      value: { ...location.value, timeZone: "Mars/Base" },
    }).success,
    false,
  );
  assert.ok(can("ADMIN", "settings.write"));
  assert.equal(can("HR", "settings.write"), false);
  assert.equal(can("READ_ONLY", "settings.write"), false);
});
test("Editor accepts catalog codes without hardcoding new employment/experience choices", () => {
  const content = {
    title: "Role",
    responsibilities: ["Work"],
    requirements: ["Skills"],
  };
  const draft = {
    en: content,
    zh: content,
    settings: {
      departmentId: null,
      locationIds: [],
      jobType: "APPRENTICESHIP",
      experience: "LEAD",
      salary: null,
      showSalary: false,
      publishAt: null,
      closeAt: null,
    },
  };
  assert.ok(jobDraftSchema.safeParse(draft).success);
  assert.equal(
    jobDraftSchema.safeParse({
      ...draft,
      settings: { ...draft.settings, jobType: "unbounded free text" },
    }).success,
    false,
  );
});
