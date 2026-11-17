import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  parseJobQuery,
  jobDraftSchema,
  createJobSchema,
  saveJobSchema,
} from "../../../src/server/jobs/management-contract.ts";
import { authorizeJobCron } from "../../../src/server/jobs/expiry.ts";
import { adminJobDto } from "../../../src/server/admin/dto.ts";
import { publicJobDto } from "../../../src/server/jobs/public-dto.ts";
import { sendJobCommand } from "../../../src/lib/admin/jobClient.ts";

export const draft = () => ({
  en: {
    title: "Support",
    responsibilities: ["Help"],
    requirements: ["Experience"],
  },
  zh: {
    title: "Support ZH",
    responsibilities: ["Help ZH"],
    requirements: ["Experience ZH"],
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
test("Multi-status OR query deduplicates, bounds pagination and rejects unknown/empty statuses", () => {
  assert.deepEqual(
    parseJobQuery(
      new URLSearchParams(
        "status=published&status=paused&status=published&q= support &page=2",
      ),
    ),
    { statuses: ["published", "paused"], q: "support", page: 2, pageSize: 20 },
  );
  for (const query of [
    "status=",
    "status=PUBLISHED",
    "page=0",
    "page=-1",
    "page=1.2",
    "pageSize=101",
    "pageSize=0",
    `q=${"a".repeat(201)}`,
  ])
    assert.throws(() => parseJobQuery(new URLSearchParams(query)));
});
test("Draft writes reject mass assignment, ambiguous dates, invalid salaries and duplicates", () => {
  const value = draft();
  assert.ok(jobDraftSchema.safeParse(value).success);
  assert.ok(
    !createJobSchema.safeParse({
      id: randomUUID(),
      requestId: randomUUID(),
      slug: "safe",
      draft: value,
      ownerId: randomUUID(),
    }).success,
  );
  assert.ok(
    !saveJobSchema.safeParse({
      requestId: randomUUID(),
      slug: "safe",
      draft: value,
      expectedVersion: 0,
    }).success,
  );
  for (const invalid of [
    { publishAt: "2026-10-26" },
    { closeAt: "2026-10-27T10:00:00" },
    {
      locationIds: [
        value.settings.locationIds[0],
        value.settings.locationIds[0],
      ],
    },
    { salary: { min: 50, max: 20, currency: "USD", period: "MONTH" } },
    { showSalary: true },
  ])
    assert.ok(
      !jobDraftSchema.safeParse({
        ...value,
        settings: { ...value.settings, ...invalid },
      }).success,
    );
});
test("Cron rejects missing configuration and every unauthenticated/cookie-only invocation", () => {
  const before = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.throws(() => authorizeJobCron(new Request("http://localhost")), {
      status: 503,
    });
    process.env.CRON_SECRET = "a".repeat(40);
    for (const headers of [
      {},
      { cookie: "staff=admin" },
      { authorization: "Bearer wrong" },
      { "user-agent": "vercel-cron/1.0" },
    ])
      assert.throws(
        () => authorizeJobCron(new Request("http://localhost", { headers })),
        { status: 401 },
      );
    assert.doesNotThrow(() =>
      authorizeJobCron(
        new Request("http://localhost", {
          headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        }),
      ),
    );
  } finally {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  }
});
test("Unpublished changes compare content and settings, independently of lifecycle version bumps", () => {
  const value = draft();
  const row = {
    id: randomUUID(),
    canonical_slug: "safe",
    status: "PAUSED",
    draft_content: value,
    published_content: { ...value, englishFallback: false },
    version: 4,
    published_version: 2,
    created_at: new Date(),
    location_ids: [],
  };
  assert.equal(adminJobDto(row).hasUnpublishedChanges, false);
  const dated = structuredClone(value);
  dated.settings.publishAt = "2026-10-25T10:00:00+02:00";
  const approved = structuredClone(dated);
  approved.settings.publishAt = "2026-10-25T08:00:00.000Z";
  const normalized = adminJobDto({
    ...row,
    draft_content: dated,
    published_content: approved,
  });
  assert.equal(
    normalized.draft.settings.publishAt,
    approved.settings.publishAt,
  );
  assert.equal(normalized.hasUnpublishedChanges, false);
  assert.equal(
    adminJobDto({
      ...row,
      draft_content: {
        ...value,
        settings: { ...value.settings, closeAt: "2026-12-01T00:00:00Z" },
      },
    }).hasUnpublishedChanges,
    true,
  );
});
test("Chinese fallback is explicit, labelled in the public contract and never fabricates translations", () => {
  const value = draft();
  value.en = { title: "", responsibilities: [], requirements: [] };
  const row = {
    id: randomUUID(),
    canonical_slug: "safe",
    published_content: { ...value, englishFallback: true },
    publish_at: new Date(),
    close_at: null,
    department_en: "Ops",
    department_zh: "Ops ZH",
    locations: [{ en: "Local", zh: "Local ZH" }],
    job_type: "FULL_TIME",
    type_label: { en: "Full-time", zh: "全职" },
    experience_label: { en: "Any experience", zh: "经验不限" },
    experience: "ANY",
    show_salary: false,
  };
  const job = publicJobDto(row);
  assert.equal(job.contentLanguage, "zh");
  assert.equal(job.title.en, value.zh.title);
  assert.ok(!("settings" in job));
  assert.throws(() => publicJobDto({ ...row, published_content: value }));
});
test("Job client sends versions and exposes conflicts without optimistic success", async () => {
  await assert.rejects(
    sendJobCommand(
      "/api/admin/jobs/id",
      "PATCH",
      { expectedVersion: 3 },
      async (path, init) => {
        assert.equal(path, "/api/admin/jobs/id");
        assert.equal(init.cache, "no-store");
        assert.equal(JSON.parse(init.body).expectedVersion, 3);
        return new Response("{}", { status: 409 });
      },
    ),
    { status: 409 },
  );
});
