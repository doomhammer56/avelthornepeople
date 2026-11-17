import test from "node:test";
import assert from "node:assert/strict";
import { createAdminQueryClient } from "../../../src/lib/admin/queryClient.ts";
import {
  jobsQueryKey,
  jobsQueryOptions,
  referenceQueryOptions,
  dashboardQueryOptions,
} from "../../../src/lib/admin/queries.ts";
import { invalidateAdminResource } from "../../../src/lib/admin/cachePolicy.ts";
import {
  isAdminQueryNavigation,
  prefetchAdminQueries,
} from "../../../src/lib/admin/queryNavigation.ts";

const jobs = {
  q: "support",
  statuses: ["published", "draft"],
  page: 1,
  pageSize: 20,
};

test("jobs cache canonicalizes equivalent filters and separates search, status, page and page-size results", () => {
  const key = jobsQueryKey(jobs);
  assert.deepEqual(
    key,
    jobsQueryKey({
      ...jobs,
      q: " support ",
      statuses: ["draft", "published", "draft"],
    }),
  );
  for (const change of [
    { q: "other" },
    { statuses: ["closed"] },
    { page: 2 },
    { pageSize: 50 },
  ])
    assert.notDeepEqual(key, jobsQueryKey({ ...jobs, ...change }));
});

test("Jobs requests only the summary endpoint and retains exact filter metadata with its result", async (t) => {
  const controller = new AbortController();
  const payload = {
    jobs: [],
    total: 0,
    page: 1,
    pageSize: 20,
    statusCounts: {},
  };
  t.mock.method(globalThis, "fetch", async (path, init) => {
    const url = new URL(path, "http://localhost");
    assert.equal(url.pathname, "/api/admin/jobs/summary");
    assert.equal(url.searchParams.get("q"), "support");
    assert.deepEqual(url.searchParams.getAll("status"), ["draft", "published"]);
    assert.equal(init.cache, "no-store");
    assert.equal(init.method, "GET");
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(payload);
  });
  const options = jobsQueryOptions(jobs);
  assert.equal(options.staleTime, 30_000);
  assert.deepEqual(await options.queryFn({ signal: controller.signal }), {
    page: payload,
    filters: jobs,
  });
});

test("prefetch and screen reads share Jobs/reference/Dashboard entries without duplicate transport reads", async (t) => {
  const client = createAdminQueryClient();
  const paths = [];
  t.mock.method(globalThis, "fetch", async (path) => {
    paths.push(path);
    return Response.json(
      path.startsWith("/api/admin/dashboard")
        ? { period: { range: 30 } }
        : { jobs: [], total: 0 },
    );
  });
  try {
    await prefetchAdminQueries(
      client,
      new URL(
        "http://localhost/admin/jobs?q=support&status=draft&status=published",
      ),
    );
    await client.fetchQuery(jobsQueryOptions(jobs));
    await client.fetchQuery(referenceQueryOptions);
    assert.equal(paths.length, 2);
    await prefetchAdminQueries(
      client,
      new URL("http://localhost/admin?range=30&lang=en"),
    );
    await client.fetchQuery(dashboardQueryOptions(30));
    assert.equal(paths.length, 3);
    await client.fetchQuery(dashboardQueryOptions(7));
    assert.equal(paths.length, 4);
    assert.ok(paths.includes("/api/admin/settings"));
    assert.equal(referenceQueryOptions.staleTime, 300_000);
  } finally {
    client.clear();
  }
});

test("job and application writes reconcile job counts and every cached Dashboard range", async () => {
  for (const resource of ["jobs", "applications"]) {
    const client = createAdminQueryClient();
    const keys = [
      jobsQueryKey(jobs),
      jobsQueryKey({ ...jobs, page: 2 }),
      ...[7, 30, 90].map((range) => dashboardQueryOptions(range).queryKey),
    ];
    try {
      for (const key of [...keys, referenceQueryOptions.queryKey])
        client.setQueryData(key, { version: 1 });
      await invalidateAdminResource(client, resource);
      for (const key of keys)
        assert.equal(client.getQueryState(key).isInvalidated, true);
      assert.equal(
        client.getQueryState(referenceQueryOptions.queryKey).isInvalidated,
        false,
      );
    } finally {
      client.clear();
    }
  }
});

test("reference writes reconcile labels and manual refresh invalidates future admin resources too", async () => {
  const client = createAdminQueryClient();
  const other = ["admin", "future-resource"];
  try {
    for (const key of [
      jobsQueryKey(jobs),
      referenceQueryOptions.queryKey,
      other,
    ])
      client.setQueryData(key, {});
    await invalidateAdminResource(client, "settings");
    assert.equal(client.getQueryState(jobsQueryKey(jobs)).isInvalidated, true);
    assert.equal(
      client.getQueryState(referenceQueryOptions.queryKey).isInvalidated,
      true,
    );
    assert.equal(client.getQueryState(other).isInvalidated, false);
    await invalidateAdminResource(client, "all");
    assert.equal(client.getQueryState(other).isInvalidated, true);
  } finally {
    client.clear();
  }
});

test("native query navigation stays on cache-owned screens and cannot bypass language or route transitions", () => {
  const current = "https://portal.example/admin/jobs?lang=en&q=old";
  assert.equal(
    isAdminQueryNavigation(
      "/admin/jobs?lang=en&status=draft",
      "https://portal.example/admin/jobs",
      "en",
    ),
    true,
  );
  assert.equal(
    isAdminQueryNavigation(
      "/admin?lang=zh&range=7",
      "https://portal.example/admin",
      "zh",
    ),
    true,
  );
  assert.equal(
    isAdminQueryNavigation(
      "/admin?lang=en&range=7",
      "https://portal.example/admin",
      "zh",
    ),
    false,
  );
  assert.equal(
    isAdminQueryNavigation("/admin/jobs?lang=en&q=new&page=2", current),
    true,
  );
  assert.equal(
    isAdminQueryNavigation(
      "/admin?range=7&lang=en",
      "https://portal.example/admin?lang=en",
    ),
    true,
  );
  for (const href of [
    "https://other.example/admin/jobs?lang=en",
    "/admin/jobs/new?lang=en",
    "/admin/jobs?lang=zh",
    "/admin/jobs?lang=en#section",
  ])
    assert.equal(isAdminQueryNavigation(href, current), false);
  assert.equal(
    isAdminQueryNavigation(
      "/admin/settings?lang=en&page=2",
      "https://portal.example/admin/settings?lang=en",
    ),
    false,
  );
});

test("invalid prefetch filters never issue data requests", async (t) => {
  const client = createAdminQueryClient();
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => {
    reads++;
    return Response.json({});
  });
  try {
    await assert.rejects(
      prefetchAdminQueries(
        client,
        new URL("http://localhost/admin/jobs?status=bogus"),
      ),
    );
    await assert.rejects(
      prefetchAdminQueries(
        client,
        new URL("http://localhost/admin?range=7&range=30"),
      ),
    );
    assert.equal(reads, 0);
  } finally {
    client.clear();
  }
});
