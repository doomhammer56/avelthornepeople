import assert from "node:assert/strict";
import test from "node:test";
import { homeJobs } from "./homeJobs.ts";
import { parsePublicJob } from "./publicJobSchema.ts";
import {
  getJobListingQuery,
  isPublicJobOpen,
  formatPublicJobDeadline,
} from "./jobNavigation.ts";
import { buildJobPostingJsonLd } from "./jobPostingSchema.ts";

const job = {
  ...homeJobs[0],
  status: "open",
  closesAt: "2026-11-30",
  responsibilities: { en: ["Example responsibility"], zh: ["示例职责"] },
  requirements: { en: ["Example requirement"], zh: ["示例要求"] },
};

// Check the detail boundary before descriptions reach metadata or public markup.
// Missing translations, invalid dates and internal fields must not silently pass through.
test("job details require complete translated lists and a valid closing date", () => {
  const parsed = parsePublicJob({ job: { ...job, internalNotes: "internal" } });
  assert.equal(parsed.slug, homeJobs[0].slug);
  assert.equal("internalNotes" in parsed, false);
  for (const change of [
    { requirements: { en: [], zh: ["示例"] } },
    { responsibilities: { en: ["Example"] } },
    { closesAt: "2026-02-30" },
    { closesAt: "2026-01-01" },
    { status: "draft" },
  ])
    assert.throws(() => parsePublicJob({ job: { ...job, ...change } }));
  assert.equal(
    parsePublicJob({ job: { ...job, closesAt: null } }).closesAt,
    null,
  );
});

// Use fixed UTC instants to verify the inclusive deadline boundary.
// Confirm hidden salary is removed at the public boundary, not merely hidden with CSS.
test("salary requires explicit visibility and a valid ordered range", () => {
  const salary = {
    min: 3000,
    max: 5000,
    currency: "MYR",
    period: { en: "month", zh: "月" },
  };
  assert.equal(parsePublicJob({ job: { ...job, salary } }).salary, undefined);
  assert.equal(
    parsePublicJob({ job: { ...job, salary, showSalary: false } }).salary,
    undefined,
  );
  assert.deepEqual(
    parsePublicJob({ job: { ...job, salary, showSalary: true } }).salary,
    salary,
  );
  assert.throws(() =>
    parsePublicJob({
      job: { ...job, salary: { ...salary, min: 6000 }, showSalary: true },
    }),
  );
});

test("structured salary units use canonical codes in both languages", () => {
  for (const periodCode of ["HOUR", "DAY", "MONTH", "YEAR"]) {
    const parsed = parsePublicJob({
      job: {
        ...job,
        showSalary: true,
        salary: {
          min: 20,
          max: 40,
          currency: "USD",
          periodCode,
          period: { en: "Year", zh: "年" },
        },
      },
    });
    for (const locale of ["en", "zh"]) {
      const schema = buildJobPostingJsonLd(
        parsed,
        locale,
        new URL("https://example.test"),
      );
      assert.equal(schema.baseSalary.value.unitText, periodCode);
    }
  }
});

test("structured data omits an unknown salary unit instead of inventing a monthly rate", () => {
  const parsed = parsePublicJob({
    job: {
      ...job,
      showSalary: true,
      salary: {
        min: 20,
        max: 40,
        currency: "USD",
        period: { en: "Custom", zh: "Custom" },
      },
    },
  });
  assert.equal(
    buildJobPostingJsonLd(parsed, "en", new URL("https://example.test"))
      .baseSalary,
    undefined,
  );
  for (const periodCode of ["WEEK", "hour", "", null]) {
    assert.throws(() =>
      parsePublicJob({
        job: { ...parsed, salary: { ...parsed.salary, periodCode } },
      }),
    );
  }
});

// Use fixed UTC instants to verify the inclusive deadline boundary.
// A role must stop rendering as open once closed or past its final date.
test("publication state and closing dates determine detail availability", () => {
  assert.equal(isPublicJobOpen(job, new Date("2026-11-30T23:59:59Z")), true);
  assert.equal(isPublicJobOpen(job, new Date("2026-12-01T00:00:00Z")), false);
  assert.equal(
    isPublicJobOpen(
      { ...job, status: "closed" },
      new Date("2026-10-20T00:00:00Z"),
    ),
    false,
  );
  assert.equal(
    isPublicJobOpen(
      { ...job, closesAt: null },
      new Date("2030-01-01T00:00:00Z"),
    ),
    true,
  );
});

test("exact deadlines close at the precise instant and survive public metadata", () => {
  const parsed = parsePublicJob({
    job: { ...job, closesAt: "2026-11-30T08:00:00.123Z" },
  });
  assert.equal(
    isPublicJobOpen(parsed, new Date("2026-11-30T08:00:00.122Z")),
    true,
  );
  assert.equal(
    isPublicJobOpen(parsed, new Date("2026-11-30T08:00:00.123Z")),
    false,
  );
  assert.equal(
    isPublicJobOpen(parsed, new Date("2026-11-30T09:00:00Z")),
    false,
  );
  assert.equal(
    buildJobPostingJsonLd(parsed, "en", new URL("https://example.test"))
      .validThrough,
    "2026-11-30T08:00:00.123Z",
  );
});

test("timezone offsets and repeated daylight-saving times compare by instant", () => {
  const early = parsePublicJob({
    job: { ...job, closesAt: "2026-11-01T01:30:00-04:00" },
  });
  const late = parsePublicJob({
    job: { ...job, closesAt: "2026-11-01T01:30:00-05:00" },
  });
  const now = new Date("2026-11-01T06:00:00Z");
  assert.equal(isPublicJobOpen(early, now), false);
  assert.equal(isPublicJobOpen(late, now), true);
  assert.equal(
    parsePublicJob({ job: { ...job, closesAt: "2026-12-01T01:00:00+08:00" } })
      .closesAt,
    "2026-11-30T17:00:00.000Z",
  );
});

test("deadline display includes the exact UTC time in both languages", () => {
  for (const locale of ["en", "zh"]) {
    const label = formatPublicJobDeadline("2026-11-30T08:15:20Z", locale);
    assert.match(label, /08:15:20/);
    assert.match(label, /UTC/);
    assert.equal(formatPublicJobDeadline("2026-11-30", locale), "2026-11-30");
  }
});

// Preserve only recognized filters when generating a return-to-list link.
// Redirect-like input cannot change the local destination or inject unrelated parameters.
test("detail navigation whitelists and bounds carried listing filters", () => {
  const query = getJobListingQuery(
    new URLSearchParams({
      q: "客服 & support",
      location: "Manila",
      returnTo: "https://example.test",
      type: "x".repeat(500),
      experience: "Senior",
      page: "2",
    }),
  );
  const parsed = new URLSearchParams(query);
  assert.equal(parsed.get("q"), "客服 & support");
  assert.equal(parsed.get("location"), "Manila");
  assert.equal(parsed.has("returnTo"), false);
  assert.equal(parsed.get("type").length, 200);
  assert.equal(parsed.get("experience"), "Senior");
  assert.equal(parsed.get("page"), "2");
  assert.equal(getJobListingQuery(new URLSearchParams({ page: "-1" })), "");
  assert.equal(getJobListingQuery(new URLSearchParams()), "");
});
