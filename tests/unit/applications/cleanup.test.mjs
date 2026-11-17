import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { cleanupApplicationUploads } from "../../../src/server/applications/cleanup.ts";

function batch(size) {
  return Array.from({ length: size }, () => {
    const id = randomUUID();
    return {
      id,
      objectKey: `${id}/${randomUUID()}.pdf`,
      leaseToken: randomUUID(),
      providerExpiresAt: new Date(Date.now() - 600000).toISOString(),
    };
  });
}
function fixture(
  batches,
  { providerFails = false, finishFails = false, exhaustBudget = false } = {},
) {
  const calls = [];
  let active = false,
    clock = 0;
  const dependencies = {
    now: () => clock,
    runTransaction: async (subject, action) => {
      assert.equal(subject, null);
      assert.equal(active, false);
      active = true;
      try {
        return await action({
          query: async (sql, params) => {
            if (sql.includes("claim_application")) {
              calls.push("claim");
              return { rows: [{ uploads: batches.shift() ?? [] }] };
            }
            calls.push("finish");
            if (finishFails) throw new Error("Database unavailable");
            const results = JSON.parse(params[0]);
            return {
              rows: [
                {
                  result: {
                    removed: results.filter((row) => row.status === "removed")
                      .length,
                    failed: results.filter((row) => row.status === "failed")
                      .length,
                    skipped: 0,
                  },
                },
              ],
            };
          },
        });
      } finally {
        active = false;
      }
    },
    storage: () => ({
      removeExpiredQuarantines: async (intents) => {
        assert.equal(
          active,
          false,
          "Storage must run after the claim transaction releases its connection",
        );
        assert.ok(intents.length <= 20);
        assert.ok(
          intents.every((intent) => intent.providerExpiresAt instanceof Date),
        );
        calls.push(["remove", intents.length]);
        if (exhaustBudget) clock += 20001;
        if (providerFails) throw new Error("Storage unavailable");
      },
    }),
  };
  return { calls, dependencies };
}

test("twenty files use one Storage call and one batch-finalization transaction", async () => {
  const f = fixture([batch(20)]);
  assert.deepEqual(await cleanupApplicationUploads(f.dependencies), {
    removed: 20,
    failed: 0,
    skipped: 0,
    batches: 1,
  });
  assert.deepEqual(f.calls, ["claim", ["remove", 20], "finish", "claim"]);
});

test("cleanup stops at ten batches or the elapsed scheduling budget", async () => {
  const full = fixture(Array.from({ length: 12 }, () => batch(20)));
  assert.equal(
    (await cleanupApplicationUploads(full.dependencies)).removed,
    200,
  );
  assert.equal(full.calls.filter((call) => call === "claim").length, 10);
  const slow = fixture([batch(20), batch(20)], { exhaustBudget: true });
  assert.equal(
    (await cleanupApplicationUploads(slow.dependencies)).removed,
    20,
  );
  assert.equal(slow.calls.filter((call) => call === "claim").length, 1);
});

test("provider failures finalize backoff once and stop further work in that run", async () => {
  const f = fixture([batch(20), batch(20)], { providerFails: true });
  assert.deepEqual(await cleanupApplicationUploads(f.dependencies), {
    removed: 0,
    failed: 20,
    skipped: 0,
    batches: 1,
  });
  assert.deepEqual(f.calls, ["claim", ["remove", 20], "finish"]);
});

test("database finalization failures do not report successful removal", async () => {
  const f = fixture([batch(3)], { finishFails: true });
  await assert.rejects(
    cleanupApplicationUploads(f.dependencies),
    /Database unavailable/,
  );
  assert.deepEqual(f.calls, ["claim", ["remove", 3], "finish"]);
});

test("an empty queue needs no Storage configuration or HTTP request", async () => {
  const f = fixture([]);
  assert.deepEqual(await cleanupApplicationUploads(f.dependencies), {
    removed: 0,
    failed: 0,
    skipped: 0,
    batches: 0,
  });
  assert.deepEqual(f.calls, ["claim"]);
});
