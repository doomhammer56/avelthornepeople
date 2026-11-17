import test from "node:test";
import assert from "node:assert/strict";
import { completeContactFilters } from "../../../src/lib/admin/applicationFilters.ts";
import { applicationListHref } from "../../../src/lib/admin/recruitmentClient.ts";

test("automatic contact lookup waits for complete email, phone and country values", () => {
  const blank = { email: "", phone: "", region: "" };
  assert.equal(completeContactFilters({ ...blank, email: "candidate@" }), null);
  assert.equal(completeContactFilters({ ...blank, phone: "+1202" }), null);
  assert.equal(completeContactFilters({ ...blank, phone: "2025550123" }), null);
  assert.equal(completeContactFilters({ ...blank, region: "U" }), null);
  assert.equal(completeContactFilters({ ...blank, region: "ZZ" }), null);
  assert.deepEqual(
    completeContactFilters({ ...blank, phone: "2025550123", region: "us" }),
    { email: undefined, phone: "2025550123", region: "US" },
  );
  assert.deepEqual(
    completeContactFilters({ ...blank, email: " candidate@example.invalid " }),
    { email: "candidate@example.invalid", phone: undefined, region: undefined },
  );
  assert.deepEqual(completeContactFilters(blank), {
    email: undefined,
    phone: undefined,
    region: undefined,
  });
});

test("shareable application filters omit private terms while preserving combined listing criteria", () => {
  const href = applicationListHref(
    {
      page: 1,
      pageSize: 20,
      status: ["NEW", "SCREENING"],
      source: "site",
      jobId: "00000000-0000-4000-8000-000000000001",
      email: "candidate@example.invalid",
      phone: "+12025550123",
      region: "US",
    },
    "zh",
  );
  const params = new URL(href, "https://example.invalid").searchParams;
  assert.deepEqual(params.getAll("status"), ["NEW", "SCREENING"]);
  assert.equal(params.get("source"), "site");
  assert.equal(params.get("lang"), "zh");
  for (const key of ["email", "phone", "region"])
    assert.equal(params.has(key), false);
});
