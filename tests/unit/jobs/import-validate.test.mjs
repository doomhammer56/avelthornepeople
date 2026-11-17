import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  validateImportRows,
  importLines,
} from "../../../src/lib/admin/jobImport/validate.ts";
import {
  columnForHeader,
  headerLabel,
  importColumns,
} from "../../../src/lib/admin/jobImport/columns.ts";

const ref = (code, zh, en, active = true) => ({
  id: randomUUID(),
  code,
  version: 1,
  active,
  label: { zh, en },
});
const dubai = ref("DUBAI", "杜拜项目", "Dubai project");
const manila = ref("MANILA", "菲律宾项目", "Manila project");
const retired = ref("OLD", "旧项目", "Old project", false);
const refs = {
  departments: [dubai, manila, retired],
  locations: [ref("DXB", "杜拜", "Dubai"), ref("MNL", "菲律宾", "Philippines")],
  jobTypes: [
    ref("FULL_TIME", "全职", "Full-time"),
    ref("CONTRACT", "合同工", "Contract"),
  ],
  experienceLevels: [
    ref("ANY", "经验不限", "Any"),
    ref("SENIOR", "高级", "Senior"),
  ],
};
const row = (n, cells = {}) => ({
  row: n,
  cells: {
    title_zh: "部门助理",
    project: "杜拜项目",
    location: "杜拜",
    responsibilities_zh: "1.处理日常事务\n2、协助经理",
    requirements_zh: "大专以上学历",
    ...cells,
  },
});
const codes = (result) => result.issues.map((i) => `${i.column}:${i.code}`);

test("A complete row becomes a create with defaults and cleaned lines", () => {
  const out = validateImportRows([row(2)], refs, []);
  assert.equal(out.canConfirm, true);
  assert.equal(out.rows[0].action, "create");
  const draft = out.plan[0].draft;
  assert.deepEqual(draft.zh.responsibilities, ["处理日常事务", "协助经理"]);
  assert.equal(draft.settings.jobType, "FULL_TIME");
  assert.equal(draft.settings.experience, "ANY");
  assert.equal(draft.settings.departmentId, dubai.id);
  assert.equal(draft.settings.salary, null);
  assert.equal(draft.settings.publishAt, null);
});

test("Numbering is stripped but decimals and unnumbered text are kept", () => {
  assert.deepEqual(
    importLines("1.5年以上经验\n（2）英语\n③ 沟通\n\n  \n普通行"),
    ["1.5年以上经验", "英语", "沟通", "普通行"],
  );
});

test("References match by code, Chinese or English name and ignore inactive ones", () => {
  for (const project of ["DUBAI", "dubai", "杜拜项目", "Dubai project"])
    assert.equal(
      validateImportRows([row(2, { project })], refs, []).rows[0].status,
      "ok",
    );
  const bad = validateImportRows(
    [row(2, { project: "旧项目" }), row(3, { project: "Mars" })],
    refs,
    [],
  );
  assert.deepEqual(codes(bad.rows[0]), ["project:invalid_option"]);
  assert.deepEqual(codes(bad.rows[1]), ["project:invalid_option"]);
  assert.equal(bad.canConfirm, false);
});

test("Missing required cells and unknown enum values are reported per column", () => {
  const out = validateImportRows(
    [
      row(2, { title_zh: "", requirements_zh: " ", location: "" }),
      row(3, { job_type: "Freelance", experience: "Guru" }),
    ],
    refs,
    [],
  );
  assert.deepEqual(codes(out.rows[0]).sort(), [
    "location:required",
    "requirements_zh:required",
    "title_zh:required",
  ]);
  assert.deepEqual(codes(out.rows[1]).sort(), [
    "experience:invalid_option",
    "job_type:invalid_option",
  ]);
  assert.equal(out.summary.errors, 2);
});

test("Several locations split on commas and deduplicate", () => {
  const out = validateImportRows(
    [row(2, { location: "杜拜、菲律宾,杜拜" })],
    refs,
    [],
  );
  assert.equal(out.plan[0].draft.settings.locationIds.length, 2);
  const unknown = validateImportRows(
    [row(2, { location: "杜拜, 火星" })],
    refs,
    [],
  );
  assert.deepEqual(codes(unknown.rows[0]), ["location:invalid_option"]);
});

test("Salary is all-or-none, numeric, two decimals, ordered", () => {
  const full = {
    salary_min: "1,500",
    salary_max: "3000.50",
    salary_currency: "usd",
    salary_period: "月",
  };
  const ok = validateImportRows(
    [row(2, { ...full, show_salary: "是" })],
    refs,
    [],
  );
  assert.deepEqual(ok.plan[0].draft.settings.salary, {
    min: 1500,
    max: 3000.5,
    currency: "USD",
    period: "MONTH",
  });
  assert.equal(ok.plan[0].draft.settings.showSalary, true);
  const partial = validateImportRows([row(2, { salary_min: "1" })], refs, []);
  assert.deepEqual(codes(partial.rows[0]).sort(), [
    "salary_currency:incomplete_group",
    "salary_max:incomplete_group",
    "salary_period:incomplete_group",
  ]);
  const bad = validateImportRows(
    [
      row(2, { title_zh: "职位2", ...full, salary_min: "abc" }),
      row(3, { title_zh: "职位3", ...full, salary_min: "1.234" }),
      row(4, { title_zh: "职位4", ...full, salary_min: "5000" }),
      row(5, {
        title_zh: "职位5",
        ...full,
        salary_currency: "USDT",
        salary_period: "fortnight",
      }),
    ],
    refs,
    [],
  );
  assert.deepEqual(codes(bad.rows[0]), ["salary_min:invalid_number"]);
  assert.deepEqual(codes(bad.rows[1]), ["salary_min:precision"]);
  assert.deepEqual(codes(bad.rows[2]), ["salary_max:invalid_range"]);
  assert.deepEqual(codes(bad.rows[3]).sort(), [
    "salary_currency:invalid_option",
    "salary_period:invalid_option",
  ]);
  const hidden = validateImportRows([row(2, { show_salary: "yes" })], refs, []);
  assert.deepEqual(codes(hidden.rows[0]), ["show_salary:salary_required"]);
  const junk = validateImportRows([row(2, { show_salary: "maybe" })], refs, []);
  assert.deepEqual(codes(junk.rows[0]), ["show_salary:invalid_option"]);
});

test("English content is all-or-none", () => {
  const partial = validateImportRows(
    [row(2, { title_en: "Assistant" })],
    refs,
    [],
  );
  assert.deepEqual(codes(partial.rows[0]).sort(), [
    "requirements_en:incomplete_group",
    "responsibilities_en:incomplete_group",
  ]);
  const full = validateImportRows(
    [
      row(2, {
        title_en: "Assistant",
        responsibilities_en: "Help",
        requirements_en: "Diploma",
      }),
    ],
    refs,
    [],
  );
  assert.equal(full.plan[0].draft.en.title, "Assistant");
});

test("Shared editor limits apply: too many lines and too long titles", () => {
  const many = Array.from({ length: 51 }, (_, i) => `line ${i}`).join("\n");
  const out = validateImportRows(
    [
      row(2, { responsibilities_zh: many }),
      row(3, { title_zh: "x".repeat(201) }),
    ],
    refs,
    [],
  );
  assert.deepEqual(codes(out.rows[0]), ["responsibilities_zh:too_many"]);
  assert.deepEqual(codes(out.rows[1]), ["title_zh:too_long"]);
});

test("Repeated title and project inside the file is an error on the later row", () => {
  const out = validateImportRows(
    [
      row(2),
      row(3, { title_zh: " 部门助理 " }),
      row(4, { project: "菲律宾项目" }),
    ],
    refs,
    [],
  );
  assert.equal(out.rows[0].status, "ok");
  assert.deepEqual(out.rows[1].issues, [
    { column: null, code: "duplicate_in_file", otherRow: 2 },
  ]);
  assert.equal(out.rows[2].status, "ok");
});

const existing = (overrides = {}, settings = {}) => ({
  id: randomUUID(),
  version: 4,
  status: "DRAFT",
  settingsLocked: false,
  draft: {
    zh: {
      title: "部门助理",
      responsibilities: ["旧职责"],
      requirements: ["旧要求"],
    },
    en: {
      title: "Assistant",
      responsibilities: ["Old"],
      requirements: ["Old"],
    },
    settings: {
      departmentId: dubai.id,
      locationIds: [refs.locations[0].id],
      jobType: "FULL_TIME",
      experience: "ANY",
      salary: null,
      showSalary: false,
      publishAt: null,
      closeAt: "2027-01-01T00:00:00.000Z",
      ...settings,
    },
  },
  ...overrides,
});

test("An existing job is an undecided duplicate until Skip or Overwrite is chosen", () => {
  const job = existing();
  const undecided = validateImportRows([row(2)], refs, [job]);
  assert.equal(undecided.rows[0].status, "duplicate");
  assert.deepEqual(undecided.rows[0].duplicate, {
    id: job.id,
    version: 4,
    status: "DRAFT",
  });
  assert.equal(undecided.canConfirm, false);

  const skipped = validateImportRows([row(2)], refs, [job], {
    default: "skip",
    perRow: {},
  });
  assert.equal(skipped.rows[0].status, "skipped");
  assert.equal(skipped.summary.skipped, 1);
  assert.equal(skipped.canConfirm, false, "nothing left to import");

  const mixed = validateImportRows(
    [row(2), row(3, { title_zh: "新职位" })],
    refs,
    [job],
    {
      default: "skip",
      perRow: {},
    },
  );
  assert.equal(mixed.canConfirm, true);
  assert.deepEqual(
    mixed.plan.map((p) => p.action),
    ["create"],
  );
});

test("Overwrite keeps the schedule and existing English, and carries the version", () => {
  const job = existing();
  const out = validateImportRows(
    [row(2, { requirements_zh: "新要求" })],
    refs,
    [job],
    {
      default: null,
      perRow: { 2: "overwrite" },
    },
  );
  assert.equal(out.canConfirm, true);
  const [item] = out.plan;
  assert.equal(item.action, "overwrite");
  assert.equal(item.existingId, job.id);
  assert.equal(item.existingVersion, 4);
  assert.deepEqual(item.draft.zh.requirements, ["新要求"]);
  assert.equal(item.draft.en.title, "Assistant", "file had no English");
  assert.equal(item.draft.settings.closeAt, "2027-01-01T00:00:00.000Z");
});

test("Overwrite of a settings-locked job fails only when the file changes the settings", () => {
  const locked = existing({ settingsLocked: true });
  const same = validateImportRows([row(2)], refs, [locked], {
    default: "overwrite",
    perRow: {},
  });
  assert.equal(same.rows[0].status, "ok");
  const changed = validateImportRows(
    [row(2, { job_type: "Contract" })],
    refs,
    [locked],
    {
      default: "overwrite",
      perRow: {},
    },
  );
  assert.deepEqual(changed.rows[0].issues, [
    { column: null, code: "settings_locked" },
  ]);
  assert.equal(changed.canConfirm, false);
  const skipInstead = validateImportRows(
    [row(2, { job_type: "Contract" })],
    refs,
    [locked],
    {
      default: "skip",
      perRow: {},
    },
  );
  assert.equal(skipInstead.rows[0].status, "skipped");
});

test("Locked overwrite adopts the stored location order", () => {
  const two = [refs.locations[1].id, refs.locations[0].id];
  const locked = existing({ settingsLocked: true }, { locationIds: two });
  const out = validateImportRows(
    [row(2, { location: "杜拜, 菲律宾" })],
    refs,
    [locked],
    {
      default: "overwrite",
      perRow: {},
    },
  );
  assert.deepEqual(out.plan[0].draft.settings.locationIds, two);
});

test("Closed jobs never count as duplicates; several open matches cannot be overwritten", () => {
  const closed = existing({ status: "CLOSED" });
  assert.equal(
    validateImportRows([row(2)], refs, [closed]).rows[0].action,
    "create",
  );
  const twin = [existing(), existing()];
  const out = validateImportRows([row(2)], refs, twin, {
    default: "overwrite",
    perRow: {},
  });
  assert.deepEqual(out.rows[0].issues, [
    { column: null, code: "ambiguous_duplicate" },
  ]);
});

test("Header aliases match with or without the required marker, in either language", () => {
  for (const column of importColumns) {
    for (const text of [
      headerLabel(column),
      headerLabel(column).replace(" *", ""),
      column.label.zh,
      column.label.en.toUpperCase(),
      column.key,
    ])
      assert.equal(columnForHeader(text), column.key, text);
  }
  assert.equal(columnForHeader("招聘渠道"), undefined);
});

test("An empty file cannot be confirmed", () => {
  const out = validateImportRows([], refs, []);
  assert.equal(out.canConfirm, false);
});

test("The same role in different locations is not a duplicate; same location is", () => {
  const out = validateImportRows(
    [
      row(2),
      row(3, { location: "菲律宾" }),
      row(4, { location: "杜拜、菲律宾" }),
      row(5, { location: "菲律宾, 杜拜" }),
    ],
    refs,
    [],
  );
  assert.deepEqual(
    out.rows.map((r) => r.status),
    ["ok", "ok", "ok", "error"],
  );
  assert.deepEqual(out.rows[3].issues, [
    { column: null, code: "duplicate_in_file", otherRow: 4 },
  ]);
  const job = existing();
  const elsewhere = validateImportRows([row(2, { location: "菲律宾" })], refs, [
    job,
  ]);
  assert.equal(
    elsewhere.rows[0].action,
    "create",
    "other location, existing job untouched",
  );
});

test("Priority, gender and bilingual details become the staff-only recruiting block", () => {
  const out = validateImportRows(
    [
      row(2, {
        priority: "緊急",
        gender: "Women first",
        nationality_zh: " 非中國籍 ",
        nationality_en: "Non-Chinese citizens",
        working_hours_zh: "9休4",
        benefits_en: "13 months' salary",
      }),
    ],
    refs,
    [],
  );
  assert.equal(out.rows[0].status, "ok", JSON.stringify(out.rows[0].issues));
  assert.deepEqual(out.plan[0].draft.recruiting, {
    priority: "URGENT",
    gender: "FEMALE_PREFERRED",
    nationality: { zh: "非中國籍", en: "Non-Chinese citizens" },
    workingHours: { zh: "9休4" },
    benefits: { en: "13 months' salary" },
  });
  const none = validateImportRows([row(2)], refs, []);
  assert.equal(
    "recruiting" in none.plan[0].draft,
    false,
    "blank details add nothing",
  );
  const bad = validateImportRows(
    [
      row(2, { priority: "ASAP", gender: "robot" }),
      row(3, { location: "菲律宾", remark_zh: "x".repeat(4001) }),
    ],
    refs,
    [],
  );
  assert.deepEqual(codes(bad.rows[0]).sort(), [
    "gender:invalid_option",
    "priority:invalid_option",
  ]);
  assert.deepEqual(codes(bad.rows[1]), ["remark_zh:too_long"]);
});

test("Overwrite keeps existing recruiting details the file leaves blank", () => {
  const job = existing();
  job.draft.recruiting = {
    priority: "HIGH",
    nationality: { zh: "旧" },
    age: { zh: "30岁以下" },
  };
  const out = validateImportRows(
    [row(2, { priority: "紧急", nationality_zh: "新" })],
    refs,
    [job],
    { default: "overwrite", perRow: {} },
  );
  assert.deepEqual(out.plan[0].draft.recruiting, {
    priority: "URGENT",
    nationality: { zh: "新" },
    age: { zh: "30岁以下" },
  });
});
