import test from "node:test";
import assert from "node:assert/strict";
import {
  adminServerTiming,
  measureAdminPhase,
  withAdminTimings,
} from "../../../src/server/admin/timing.ts";

test("concurrent timing scopes are isolated and only report fixed phases and numeric durations", async () => {
  assert.equal(adminServerTiming(), "");
  const [a, b] = await Promise.all([
    withAdminTimings(async () => {
      await measureAdminPhase("identity", async () => Promise.resolve());
      return adminServerTiming();
    }),
    withAdminTimings(async () => {
      await measureAdminPhase("service", async () => Promise.resolve());
      return adminServerTiming();
    }),
  ]);
  assert.match(a, /^identity;dur=\d+\.\d, total;dur=\d+\.\d$/);
  assert.match(b, /^service;dur=\d+\.\d, total;dur=\d+\.\d$/);
  assert.equal(adminServerTiming(), "");
});

test("failed phases retain a duration and preserve the original error", async () => {
  await withAdminTimings(async () => {
    const error = new Error("sensitive detail must not enter timing headers");
    await assert.rejects(
      measureAdminPhase("db_work", async () => {
        throw error;
      }),
      (actual) => actual === error,
    );
    assert.match(adminServerTiming(), /db_work;dur=\d+\.\d/);
    assert.ok(!adminServerTiming().includes("sensitive"));
  });
});
