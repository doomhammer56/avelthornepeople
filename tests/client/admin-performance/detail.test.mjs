import test from "node:test";
import assert from "node:assert/strict";
import { applicationDetailOptions } from "../../../src/lib/admin/queries.ts";
import { prefetchAdminQueries } from "../../../src/lib/admin/queryNavigation.ts";
import { createAdminQueryClient } from "../../../src/lib/admin/queryClient.ts";
import { invalidateAdminResource } from "../../../src/lib/admin/cachePolicy.ts";

test("detail hover and screen reads deduplicate, retain short private lifetime and invalidate on stage/candidate changes", async (t) => {
  const client = createAdminQueryClient();
  const id = "11111111-1111-1111-1111-111111111111";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (path, init) => {
    calls++;
    assert.equal(path, `/api/admin/applications/${id}`);
    assert.equal(init.cache, "no-store");
    return Response.json({ application: { id, version: 1 } });
  });
  try {
    const options = applicationDetailOptions(id);
    assert.equal(options.staleTime, 15000);
    assert.equal(options.gcTime, 60000);
    await prefetchAdminQueries(
      client,
      new URL(`https://example.test/admin/applications/${id}?lang=en`),
    );
    await client.fetchQuery(options);
    assert.equal(calls, 1);
    await invalidateAdminResource(client, "applications");
    assert.equal(client.getQueryState(options.queryKey).isInvalidated, true);
    await client.fetchQuery(options);
    assert.equal(calls, 2);
  } finally {
    client.clear();
  }
});
