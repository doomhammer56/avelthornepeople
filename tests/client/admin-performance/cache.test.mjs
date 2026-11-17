import test from "node:test";
import assert from "node:assert/strict";
import { QueryObserver } from "@tanstack/react-query";
import { createAdminQueryClient } from "../../../src/lib/admin/queryClient.ts";
import {
  applicationQueryKey,
  applicationQueryOptions,
  adminRead,
} from "../../../src/lib/admin/queries.ts";
import { invalidateAdminResource } from "../../../src/lib/admin/cachePolicy.ts";
import { AdminRequestError } from "../../../src/lib/admin/staffClient.ts";

const query = { page: 1, pageSize: 20, status: [] };

test("a warm visit reuses data, deduplicates reads, and does not leak to another client", async () => {
  const first = createAdminQueryClient(),
    second = createAdminQueryClient();
  let reads = 0;
  const options = {
    queryKey: applicationQueryKey(query),
    queryFn: async () => ({ revision: ++reads }),
  };
  try {
    const [a, b] = await Promise.all([
      first.fetchQuery(options),
      first.fetchQuery(options),
    ]);
    assert.deepEqual(a, b);
    assert.equal(reads, 1);
    assert.equal((await first.fetchQuery(options)).revision, 1);
    assert.equal(second.getQueryData(options.queryKey), undefined);
    assert.equal((await second.fetchQuery(options)).revision, 2);
  } finally {
    first.clear();
    second.clear();
  }
});

test("stale mounted data stays visible while a background refresh reconciles it", async () => {
  const client = createAdminQueryClient();
  const key = applicationQueryKey(query);
  client.setQueryData(key, { revision: 1 }, { updatedAt: Date.now() - 60_000 });
  let finish;
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    assert.equal(observer.getCurrentResult().data.revision, 1);
    assert.equal(observer.getCurrentResult().isFetching, true);
    const refreshed = observer.refetch({ cancelRefetch: false });
    finish({ revision: 2 });
    await refreshed;
    assert.equal(observer.getCurrentResult().data.revision, 2);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("application writes invalidate every affected filtered page and badge without rereading reference options", async () => {
  const client = createAdminQueryClient();
  const a = applicationQueryKey(query),
    b = applicationQueryKey({ ...query, status: ["NEW"] });
  const badge = ["admin", "application-count"],
    options = ["admin", "application-options"];
  try {
    for (const key of [a, b, badge, options])
      client.setQueryData(key, { value: 1 });
    await invalidateAdminResource(client, "applications");
    for (const key of [a, b, badge])
      assert.equal(client.getQueryState(key).isInvalidated, true);
    assert.equal(client.getQueryState(options).isInvalidated, false);
    await invalidateAdminResource(client, "jobs");
    assert.equal(client.getQueryState(options).isInvalidated, true);
  } finally {
    client.clear();
  }
});

test("cancelled filters abort their transport and cannot overwrite a newer query", async () => {
  const client = createAdminQueryClient();
  const firstKey = applicationQueryKey(query),
    nextKey = applicationQueryKey({ ...query, page: 2 });
  let aborted = false;
  const pending = client
    .fetchQuery({
      queryKey: firstKey,
      queryFn: ({ signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
          });
        }),
    })
    .catch(() => undefined);
  try {
    await client.cancelQueries({ queryKey: firstKey });
    await client.fetchQuery({
      queryKey: nextKey,
      queryFn: async () => ({ page: 2 }),
    });
    await pending;
    assert.equal(aborted, true);
    assert.equal(client.getQueryData(firstKey), undefined);
    assert.equal(client.getQueryData(nextKey).page, 2);
  } finally {
    client.clear();
  }
});

test("private contact lookups have opaque ephemeral keys, use POST bodies and abortable no-store requests", async (t) => {
  const input = {
    ...query,
    email: "person@example.invalid",
    phone: "+250788123456",
  };
  const options = applicationQueryOptions(input, "opaque-1");
  assert.equal(options.gcTime, 0);
  assert.equal(options.staleTime, 0);
  assert.ok(!JSON.stringify(options.queryKey).includes(input.email));
  assert.ok(!JSON.stringify(options.queryKey).includes(input.phone));
  assert.notDeepEqual(
    options.queryKey,
    applicationQueryOptions(input, "opaque-2").queryKey,
  );
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, "/api/admin/applications/search");
    assert.equal(init.method, "POST");
    assert.equal(init.cache, "no-store");
    assert.deepEqual(JSON.parse(init.body), input);
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json({ applications: [] });
  });
  const result = await options.queryFn({
    signal: new AbortController().signal,
  });
  assert.deepEqual(result.page, { applications: [] });
});

test("rejected admission clears private cached state without retrying", async () => {
  for (const status of [401, 403]) {
    let errors = 0,
      attempts = 0;
    const client = createAdminQueryClient(() => {
      errors++;
      client.clear();
    });
    client.setQueryData(applicationQueryKey(query), { private: true });
    try {
      await assert.rejects(
        client.fetchQuery({
          queryKey: ["admin", "denied"],
          queryFn: async () => {
            attempts++;
            throw new AdminRequestError(status);
          },
        }),
      );
      assert.equal(attempts, 1);
      assert.equal(errors, 1);
      assert.equal(client.getQueryCache().getAll().length, 0);
    } finally {
      client.clear();
    }
  }
});

test("a resource 403 drops its old data while the provider checks admission; other pages remain cached", async () => {
  let checks = 0;
  const client = createAdminQueryClient(() => checks++);
  const deniedKey = ["admin", "restricted-resource"];
  const allowedKey = applicationQueryKey(query);
  client.setQueryData(
    deniedKey,
    { private: "old denied data" },
    { updatedAt: 1 },
  );
  client.setQueryData(allowedKey, { private: "allowed page" });
  try {
    await assert.rejects(
      client.fetchQuery({
        queryKey: deniedKey,
        queryFn: async () => {
          throw new AdminRequestError(403);
        },
      }),
    );
    assert.equal(checks, 1);
    assert.equal(client.getQueryData(deniedKey), undefined);
    assert.equal(client.getQueryState(deniedKey).status, "error");
    assert.deepEqual(client.getQueryData(allowedKey), {
      private: "allowed page",
    });
  } finally {
    client.clear();
  }
});

test("a denied HTTP read preserves its status for admission handling", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 403 }),
  );
  await assert.rejects(
    adminRead("/api/admin/me"),
    (error) => error.status === 403,
  );
});

test("a transient refresh failure keeps the last successful snapshot available", async () => {
  const client = createAdminQueryClient();
  const key = applicationQueryKey(query);
  client.setQueryData(key, { revision: 1 });
  const observer = new QueryObserver(client, {
    queryKey: key,
    enabled: false,
    retry: false,
    queryFn: async () => {
      throw new AdminRequestError(503);
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    assert.equal(observer.getCurrentResult().isError, true);
    assert.equal(observer.getCurrentResult().data.revision, 1);
  } finally {
    unsubscribe();
    client.clear();
  }
});
