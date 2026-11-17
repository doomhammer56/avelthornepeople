import assert from "node:assert/strict";
import test from "node:test";
import { homeJobs } from "../../../src/lib/homeJobs.ts";
import {
  publicJobQuery,
  previewPublicJobPage,
  parsePublicJobPage,
} from "../../../src/lib/publicJobQuery.ts";
import {
  getPublicJobs,
  getPublicJobsForSitemap,
} from "../../../src/lib/getPublicJobs.ts";

test("Public query bounds page sizes, filters and malformed URLs", () => {
  for (const page of ["0", "-1", "1.5", "Infinity", "1000000"])
    assert.equal(publicJobQuery(new URLSearchParams({ page })).page, 1);
  for (const pageSize of ["0", "-1", "101", "Infinity", "1.5"])
    assert.equal(
      publicJobQuery(new URLSearchParams({ pageSize })).pageSize,
      10,
    );
  assert.equal(
    publicJobQuery(new URLSearchParams({ q: "x".repeat(500) })).filters.query
      .length,
    200,
  );
});
test("Page envelope rejects truncation, wrong totals, missing facets and duplicate IDs", () => {
  const query = publicJobQuery(
    new URLSearchParams({ pageSize: "6", facets: "1" }),
  );
  const page = previewPublicJobPage(homeJobs, query);
  assert.deepEqual(parsePublicJobPage(page, query), page);
  for (const override of [
    { jobs: page.jobs.slice(1) },
    { totalPages: 999 },
    { page: 2 },
    { facets: null },
    { jobs: [page.jobs[0], ...page.jobs.slice(0, 5)] },
  ])
    assert.throws(() => parsePublicJobPage({ ...page, ...override }, query));
});
test("Public API mode passes filters and fetches every sitemap page without treating failures as fixtures", async (t) => {
  const source = process.env.PUBLIC_JOBS_SOURCE,
    base = process.env.PUBLIC_API_BASE_URL;
  process.env.PUBLIC_JOBS_SOURCE = "api";
  process.env.PUBLIC_API_BASE_URL = "https://jobs.example.invalid";
  t.after(() => {
    if (source === undefined) delete process.env.PUBLIC_JOBS_SOURCE;
    else process.env.PUBLIC_JOBS_SOURCE = source;
    if (base === undefined) delete process.env.PUBLIC_API_BASE_URL;
    else process.env.PUBLIC_API_BASE_URL = base;
  });
  const many = Array.from({ length: 213 }, (_, i) => ({
    ...homeJobs[0],
    id: `job-${String(i).padStart(3, "0")}`,
    slug: `job-${i}`,
  }));
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(init.next.revalidate, 30);
    assert.deepEqual(init.next.tags, ["public-jobs"]);
    const query = publicJobQuery(url.searchParams);
    return Response.json(previewPublicJobPage(many, query));
  });
  const filtered = await getPublicJobs(
    new URLSearchParams({ q: "no matching title", page: "9", facets: "1" }),
  );
  assert.equal(filtered.total, 0);
  assert.equal(filtered.failed, false);
  assert.equal(calls[0].searchParams.get("q"), "no matching title");
  calls.length = 0;
  const all = await getPublicJobsForSitemap();
  assert.equal(all.jobs.length, 213);
  assert.equal(new Set(all.jobs.map((j) => j.slug)).size, 213);
  assert.equal(calls.length, 3);
  assert.deepEqual(Object.keys(all.jobs[0]).sort(), ["postedAt", "slug"]);
  t.mock.method(globalThis, "fetch", async (input) => {
    const page = previewPublicJobPage(
      many,
      publicJobQuery(new URL(input).searchParams),
    );
    return Response.json({
      ...page,
      jobs: page.jobs.map((job, i) => ({ ...job, slug: `duplicate-${i}` })),
    });
  });
  assert.equal((await getPublicJobsForSitemap()).failed, true);
  t.mock.method(globalThis, "fetch", async () => Response.json({ jobs: many }));
  const failure = await getPublicJobs();
  assert.equal(failure.failed, true);
  assert.deepEqual(failure.jobs, []);
});
