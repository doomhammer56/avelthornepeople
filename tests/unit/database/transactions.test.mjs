import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { withRuntime } from "../../../src/server/database/runtime.ts";
import { withPublicReader } from "../../../src/server/database/public.ts";
import { incrementDetailView } from "../../../src/server/analytics/repository.ts";
import { closeExpiredJobs } from "../../../src/server/jobs/expiry.ts";
import { staffInTransaction } from "../../../src/server/auth/staff.ts";

function fixture(
  overrides = {},
  { failAction = false, malformed = false } = {},
) {
  const calls = [];
  const role = {
    restricted: true,
    runtime_member: true,
    reader: true,
    writer: true,
    owner_member: false,
    mixed: false,
    memberships: ["portal_jobs_worker"],
    ...overrides,
  };
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes("FROM pg_roles")) {
        if (
          sql.trim().startsWith("BEGIN;") ||
          sql.trim().startsWith("BEGIN READ ONLY;")
        )
          return malformed
            ? { rows: [role] }
            : [
                { command: "BEGIN", rows: [] },
                { command: "SELECT", rows: [role] },
                { command: "SET", rows: [] },
              ];
        return { rows: [role] };
      }
      if (sql.includes("record_job_detail_view"))
        return { rows: [{ retry: 0 }] };
      if (sql.includes("close_expired_jobs"))
        return { rows: [{ processed: 1, remaining: false }] };
      if (sql === "SELECT 'business'") {
        if (failAction) throw new Error("business failed");
        return { rows: [{ value: "business" }] };
      }
      return { rows: [] };
    },
    release: () => calls.push({ sql: "RELEASE" }),
  };
  return { calls, client, pool: { connect: async () => client } };
}

test("runtime setup and one business query need four exchanges with claims still parameterized", async () => {
  const f = fixture();
  const subject = "untrusted'; SELECT 'injection'; --",
    sessionId = randomUUID();
  await withRuntime(
    subject,
    (db) => db.query("SELECT 'business'"),
    f.pool,
    sessionId,
  );
  assert.equal(f.calls.filter((call) => call.sql !== "RELEASE").length, 4);
  assert.equal(
    f.calls.some((call) => call.sql.includes(subject)),
    false,
  );
  const claims = f.calls.find((call) => call.sql.includes("set_config"));
  assert.equal(claims.values[0], subject);
  assert.deepEqual(JSON.parse(claims.values[1]), {
    sub: subject,
    session_id: sessionId,
  });
  assert.deepEqual(
    f.calls.slice(-2).map((call) => call.sql),
    ["COMMIT", "RELEASE"],
  );
});

test("public and analytics operations use three exchanges and worker batches combine begin/role", async () => {
  const publicRead = fixture();
  await withPublicReader(
    (db) => db.query("SELECT 'business'"),
    publicRead.pool,
  );
  assert.equal(
    publicRead.calls.filter((call) => call.sql !== "RELEASE").length,
    3,
  );
  assert.ok(publicRead.calls[0].sql.startsWith("BEGIN READ ONLY;"));
  const analytics = fixture();
  assert.equal(
    await incrementDetailView(
      randomUUID(),
      "en",
      "direct",
      randomUUID(),
      analytics.pool,
    ),
    0,
  );
  assert.equal(
    analytics.calls.filter((call) => call.sql !== "RELEASE").length,
    3,
  );
  const worker = fixture();
  assert.equal((await closeExpiredJobs(worker.pool)).processed, 1);
  assert.equal(worker.calls.filter((call) => call.sql !== "RELEASE").length, 4);
});

test("failed checks and malformed multi-statement results cannot execute business code", async () => {
  for (const changes of [
    { restricted: false },
    { runtime_member: false },
    { owner_member: true },
  ]) {
    const f = fixture(changes);
    let reached = false;
    await assert.rejects(
      withRuntime(
        randomUUID(),
        async () => {
          reached = true;
        },
        f.pool,
      ),
      { status: 503 },
    );
    assert.equal(reached, false);
    assert.equal(
      f.calls.some((call) => call.sql.includes("set_config")),
      false,
    );
    assert.deepEqual(
      f.calls.slice(-2).map((call) => call.sql),
      ["ROLLBACK", "RELEASE"],
    );
  }
  const malformed = fixture({}, { malformed: true });
  await assert.rejects(
    withRuntime(
      null,
      async () => assert.fail("must fail closed"),
      malformed.pool,
    ),
    { status: 503 },
  );
});

test("role separation remains enforced for public and analytics connections", async () => {
  for (const changes of [
    { restricted: false },
    { mixed: true },
    { owner_member: true },
    { reader: false },
  ]) {
    const f = fixture(changes);
    await assert.rejects(
      withPublicReader(async () => assert.fail("forbidden reader"), f.pool),
    );
    assert.deepEqual(
      f.calls.slice(-2).map((call) => call.sql),
      ["ROLLBACK", "RELEASE"],
    );
  }
  for (const changes of [
    { restricted: false },
    { mixed: true },
    { owner_member: true },
    { writer: false },
  ]) {
    const f = fixture(changes);
    await assert.rejects(
      incrementDetailView(randomUUID(), "en", "direct", randomUUID(), f.pool),
      { status: 503 },
    );
    assert.equal(
      f.calls.some((call) => call.sql.includes("record_job_detail_view")),
      false,
    );
  }
});

test("business errors roll back and release the checked-out connection", async () => {
  for (const run of [
    (pool) =>
      withRuntime(randomUUID(), (db) => db.query("SELECT 'business'"), pool),
    (pool) => withPublicReader((db) => db.query("SELECT 'business'"), pool),
  ]) {
    const f = fixture({}, { failAction: true });
    await assert.rejects(run(f.pool), /business failed/);
    assert.deepEqual(
      f.calls.slice(-2).map((call) => call.sql),
      ["ROLLBACK", "RELEASE"],
    );
  }
});

test("setup permission failures mean unavailable credentials, while business denial codes are preserved", async () => {
  for (const run of [
    (pool) =>
      withRuntime(null, async () => assert.fail("forbidden setup"), pool),
    (pool) =>
      incrementDetailView(randomUUID(), "en", "direct", randomUUID(), pool),
  ]) {
    const calls = [];
    const connection = {
      connect: async () => ({
        query: async (sql) => {
          calls.push(sql);
          if (sql === "ROLLBACK") return { rows: [] };
          throw Object.assign(new Error("SET ROLE denied"), { code: "42501" });
        },
        release: () => calls.push("RELEASE"),
      }),
    };
    await assert.rejects(run(connection), { status: 503 });
    assert.deepEqual(calls.slice(-2), ["ROLLBACK", "RELEASE"]);
  }
  const denied = Object.assign(new Error("Business permission denied"), {
    code: "42501",
  });
  const f = fixture();
  await assert.rejects(
    withRuntime(
      randomUUID(),
      async () => {
        throw denied;
      },
      f.pool,
    ),
    (error) => error === denied,
  );
});

test("one staff statement preserves 401/403 distinctions and rechecks changes on every call", async () => {
  const identity = {
    subject: randomUUID(),
    sessionId: randomUUID(),
    token: "verified",
  };
  let live = true,
    role = "HR",
    calls = 0;
  const db = {
    query: async () => {
      calls++;
      return {
        rows: [{ live, id: identity.subject, display_name: "Staff", role }],
      };
    },
  };
  assert.deepEqual(await staffInTransaction(db, identity, ["HR"]), {
    id: identity.subject,
    displayName: "Staff",
    role: "HR",
  });
  assert.equal(calls, 1);
  role = "READ_ONLY";
  await assert.rejects(staffInTransaction(db, identity, ["HR"]), {
    status: 403,
  });
  live = false;
  await assert.rejects(staffInTransaction(db, identity, ["HR"]), {
    status: 401,
  });
  assert.equal(calls, 3);
});
