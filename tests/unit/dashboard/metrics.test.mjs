import test from "node:test";
import assert from "node:assert/strict";
import {
  dashboardPeriod,
  parseDashboardRange,
  safeCount,
} from "../../../src/server/dashboard/contract.ts";
import { readDashboard } from "../../../src/server/dashboard/repository.ts";
import { detailSource } from "../../../src/server/analytics/source.ts";
import { recordDetailView } from "../../../src/server/analytics/service.ts";
const period = dashboardPeriod(7, new Date("2026-10-23T12:00:00Z"));
test("UTC range includes today across month/leap boundaries; only supported ranges accepted", () => {
  assert.equal(period.start, "2026-10-17T00:00:00.000Z");
  assert.equal(
    dashboardPeriod(7, new Date("2024-03-01T00:00:00Z")).start,
    "2024-02-24T00:00:00.000Z",
  );
  assert.equal(parseDashboardRange(), 30);
  for (const value of ["0", "14", "", " 7", "7.0"])
    assert.throws(() => parseDashboardRange(value));
  assert.equal(parseDashboardRange("90"), 90);
  assert.equal(safeCount("123"), 123);
  for (const value of ["-1", "9007199254740992", "NaN", 1.5])
    assert.throws(() => safeCount(value));
});
test("Sources use recognized UTM before external referrer and enforce hostname boundaries", () => {
  assert.equal(detailSource("LinkedIn", "", "https://site.test"), "linkedin");
  assert.equal(
    detailSource(
      "unknown",
      "https://www.jobstreet.com.my/jobs",
      "https://site.test",
    ),
    "jobstreet",
  );
  assert.equal(
    detailSource(null, "https://linkedin.com.evil.test/", "https://site.test"),
    "other",
  );
  assert.equal(
    detailSource(null, "https://site.test/en/careers", "https://site.test"),
    "direct",
  );
  assert.equal(detailSource(null, "", "https://site.test"), "direct");
});
const row = {
  total: "4",
  live: "2",
  expired: "1",
  started_at: "2026-10-01T00:00:00Z",
  daily: [{ date: "2026-10-20", value: "4", publicSite: "3", unknown: "0" }],
  sources: [
    { source: "linkedin", count: "10" },
    { source: "unrecognized", count: "2" },
    { source: "other", count: "3" },
  ],
};
const read = (data) =>
  readDashboard(
    {
      query: async (sql, args) => {
        assert.deepEqual(args, [period.start, period.end]);
        return { rows: [data] };
      },
    },
    period,
  );
test("Aggregate mapping zero fills days, combines unknown sources and uses public-site numerator", async () => {
  const result = await read(row);
  assert.equal(result.dailyApplications.length, 7);
  assert.equal(result.dailyApplications[0].value, 0);
  assert.equal(result.applications, 4);
  assert.equal(result.detailViews, 15);
  assert.equal(result.conversionRate, 20);
  assert.equal(result.sources.find((s) => s.key === "other").count, 5);
  assert.ok(
    Math.abs(result.sources.reduce((n, s) => n + s.share, 0) - 100) < 0.00001,
  );
});
test("Undefined conversion is explicit for no views, incomplete tracking or unknown channels", async () => {
  for (const overrides of [
    { sources: [] },
    { started_at: null },
    { started_at: "2026-10-20T00:00:00Z" },
    {
      daily: [
        { date: "2026-10-20", value: "4", publicSite: "3", unknown: "1" },
      ],
    },
  ]) {
    assert.equal((await read({ ...row, ...overrides })).conversionRate, null);
  }
  await assert.rejects(read({ ...row, total: "9007199254740992" }));
});
test("Collector rejects cross-origin and malformed dimensions before connecting to the database", async () => {
  const previous = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = "https://site.test";
  try {
    for (const [origin, body, status] of [
      ["https://evil.test", {}, 403],
      ["https://site.test", { jobId: "bad" }, 400],
      [
        "https://site.test",
        {
          jobId: "11111111-1111-1111-1111-111111111111",
          locale: "en",
          source: "raw URL",
        },
        400,
      ],
    ]) {
      await assert.rejects(
        recordDetailView(
          new Request("https://site.test/api/analytics/job-detail-view", {
            method: "POST",
            headers: { origin, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
        { status },
      );
    }
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = previous;
  }
});
