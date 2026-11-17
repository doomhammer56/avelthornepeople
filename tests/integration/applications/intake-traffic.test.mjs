import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import { PGlite } from "@electric-sql/pglite";

const globalKey = "00000000-0000-0000-0000-000000000000";
const baseline = readFileSync(
  "prisma/migrations/20261026000400_public_application_intake/migration.sql",
  "utf8",
).match(
  /CREATE FUNCTION portal_private\.consume_intake_traffic\([\s\S]*?END \$\$;/,
)[0];

// Execute the real PL/pgSQL, including its owner/RLS boundary, without hosted
// credentials. PGlite is single-session; this does not replace multi-session
// concurrency verification against the deployment database.
describe("Application traffic quota isolation (isolated PostgreSQL)", () => {
  let db;
  before(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE SCHEMA portal_private;
      CREATE ROLE portal_recruitment_owner NOLOGIN NOBYPASSRLS;
      CREATE ROLE portal_runtime NOLOGIN NOBYPASSRLS;
      CREATE TABLE portal_private.intake_traffic (
        key uuid PRIMARY KEY,minute_start timestamptz NOT NULL,
        day_start timestamptz NOT NULL,minute_count integer NOT NULL,
        day_count integer NOT NULL
      );
      ALTER TABLE portal_private.intake_traffic ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA portal_private TO portal_recruitment_owner,portal_runtime;
      GRANT SELECT,INSERT,UPDATE,DELETE ON portal_private.intake_traffic TO portal_recruitment_owner;
      CREATE POLICY intake_traffic_owner ON portal_private.intake_traffic
        TO portal_recruitment_owner USING(true) WITH CHECK(true);
      ${baseline}
      ALTER FUNCTION portal_private.consume_intake_traffic(uuid) OWNER TO portal_recruitment_owner;
      REVOKE ALL ON FUNCTION portal_private.consume_intake_traffic(uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION portal_private.consume_intake_traffic(uuid) TO portal_runtime;
    `);
    await db.exec(
      readFileSync(
        "prisma/migrations/20261027000100_intake_quota_isolation/migration.sql",
        "utf8",
      ),
    );
  });
  after(async () => db?.close());
  beforeEach(async () => db.exec("BEGIN"));
  afterEach(async () => db.exec("ROLLBACK"));

  async function consume(key) {
    await db.exec("SET LOCAL ROLE portal_runtime");
    try {
      return (
        await db.query(
          "SELECT portal_private.consume_intake_traffic($1::uuid) retry",
          [key],
        )
      ).rows[0].retry;
    } finally {
      await db.exec("RESET ROLE");
    }
  }
  async function bucket(key) {
    return (
      await db.query(
        "SELECT * FROM portal_private.intake_traffic WHERE key=$1",
        [key],
      )
    ).rows[0];
  }
  async function setBucket(key, minute, day, age = "0 seconds") {
    await db.query(
      `INSERT INTO portal_private.intake_traffic VALUES
       ($1,statement_timestamp()-$4::interval,statement_timestamp()-$4::interval,$2,$3)
       ON CONFLICT(key) DO UPDATE SET minute_start=EXCLUDED.minute_start,
         day_start=EXCLUDED.day_start,minute_count=$2,day_count=$3`,
      [key, minute, day, age],
    );
  }

  test("one caller's repeated rejections cannot consume another applicant's quota", async () => {
    const abusive = randomUUID();
    for (let i = 0; i < 12; i++) assert.equal(await consume(abusive), 0);
    await db.exec("SET LOCAL ROLE portal_runtime");
    const denied = await db.query(
      "SELECT portal_private.consume_intake_traffic($1) retry FROM generate_series(1,2001)",
      [abusive],
    );
    await db.exec("RESET ROLE");
    assert.ok(denied.rows.every((row) => row.retry > 0));
    assert.equal((await bucket(globalKey)).day_count, 12);
    assert.equal((await bucket(globalKey)).minute_count, 12);
    assert.equal(await consume(randomUUID()), 0);
    assert.equal((await bucket(globalKey)).day_count, 13);
  });

  test("global minute rejections do not spend daily quota or create caller buckets", async () => {
    await setBucket(globalKey, 120, 500);
    const caller = randomUUID();
    for (let i = 0; i < 25; i++) {
      const retry = await consume(caller);
      assert.ok(retry > 0 && retry <= 60);
    }
    assert.equal((await bucket(globalKey)).day_count, 500);
    assert.equal(await bucket(caller), undefined);
  });

  test("global daily exhaustion does not create caller buckets or extend the quota", async () => {
    await setBucket(globalKey, 0, 2000);
    const caller = randomUUID();
    const retry = await consume(caller);
    assert.ok(retry > 86000 && retry <= 86400);
    assert.equal((await bucket(globalKey)).day_count, 2000);
    assert.equal(await bucket(caller), undefined);
  });

  test("a caller's daily exhaustion leaves global quota available", async () => {
    const caller = randomUUID();
    await setBucket(caller, 0, 100);
    assert.ok((await consume(caller)) > 86000);
    assert.equal((await bucket(globalKey)).day_count, 0);
    assert.equal(await consume(randomUUID()), 0);
  });

  test("minute rollover resets only minute counters", async () => {
    const caller = randomUUID();
    await setBucket(globalKey, 120, 500, "61 seconds");
    await setBucket(caller, 12, 50, "61 seconds");
    assert.equal(await consume(caller), 0);
    assert.equal((await bucket(globalKey)).minute_count, 1);
    assert.equal((await bucket(globalKey)).day_count, 501);
    assert.equal((await bucket(caller)).minute_count, 1);
    assert.equal((await bucket(caller)).day_count, 51);
  });

  test("daily rollover resets exhausted global and caller windows", async () => {
    const caller = randomUUID();
    await setBucket(globalKey, 120, 2000, "25 hours");
    await setBucket(caller, 12, 100, "25 hours");
    assert.equal(await consume(caller), 0);
    assert.equal((await bucket(globalKey)).day_count, 1);
    assert.equal((await bucket(caller)).day_count, 1);
  });

  test("the shared budget stops exactly at the existing 120-call minute limit", async () => {
    for (let i = 0; i < 10; i++) {
      const caller = randomUUID();
      for (let j = 0; j < 12; j++) assert.equal(await consume(caller), 0);
    }
    const rejected = randomUUID();
    assert.ok((await consume(rejected)) > 0);
    assert.equal((await bucket(globalKey)).minute_count, 120);
    assert.equal((await bucket(globalKey)).day_count, 120);
    assert.equal(await bucket(rejected), undefined);
  });

  test("runtime can invoke the limiter but cannot change its counters directly", async () => {
    const {
      rows: [rights],
    } = await db.query(`SELECT
      has_function_privilege('portal_runtime','portal_private.consume_intake_traffic(uuid)','EXECUTE') callable,
      has_table_privilege('portal_runtime','portal_private.intake_traffic','UPDATE') writable,
      pg_get_userbyid(proowner) owner,prosecdef,proconfig
      FROM pg_proc WHERE oid='portal_private.consume_intake_traffic(uuid)'::regprocedure`);
    assert.equal(rights.callable, true);
    assert.equal(rights.writable, false);
    assert.equal(rights.owner, "portal_recruitment_owner");
    assert.equal(rights.prosecdef, true);
    assert.ok(rights.proconfig.includes('search_path=""'));
  });
});
