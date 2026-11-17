import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { withRuntime } from "../../../src/server/database/runtime.ts";
import { withPublicReader } from "../../../src/server/database/public.ts";
import { incrementDetailView } from "../../../src/server/analytics/repository.ts";
import { closeExpiredJobs } from "../../../src/server/jobs/expiry.ts";
import { staffInTransaction } from "../../../src/server/auth/staff.ts";
import { staffRead } from "../../../src/server/admin/read.ts";

// Real SQL and RLS in an isolated, single-session PostgreSQL. Adapt PGlite's
// simple-query .exec result to pg's array of results for constant setup batches.
// The original full Auth admission guards are separately exercised in the
// directory integration suite; session_probe here isolates transaction behavior.
// Test machinery switches session authorization to restricted fixture logins and
// restores the named fixture owner between cases; production wrappers never set
// session authorization, and only use transaction-local roles and claims.
describe("Checked transaction setup (isolated PostgreSQL)", () => {
  let db;
  before(async () => {
    db = new PGlite();
    await db.exec(`CREATE SCHEMA portal; CREATE SCHEMA portal_private; CREATE SCHEMA auth;
      CREATE ROLE portal_runtime NOLOGIN NOINHERIT;
      CREATE ROLE portal_public_reader NOLOGIN NOINHERIT;
      CREATE ROLE portal_public_view_owner NOLOGIN NOINHERIT;
      CREATE ROLE portal_metrics_writer NOLOGIN NOINHERIT;
      CREATE ROLE portal_metrics_owner NOLOGIN NOINHERIT;
      CREATE ROLE portal_jobs_worker NOLOGIN NOINHERIT;
      CREATE ROLE transaction_owner NOLOGIN NOINHERIT;
      CREATE ROLE transaction_runtime LOGIN NOINHERIT;
      CREATE ROLE transaction_public LOGIN NOINHERIT;
      CREATE ROLE transaction_analytics LOGIN NOINHERIT;
      CREATE ROLE transaction_worker LOGIN NOINHERIT;
      CREATE ROLE transaction_mixed LOGIN NOINHERIT;
      CREATE ROLE transaction_table_owner LOGIN NOINHERIT;
      GRANT portal_runtime TO transaction_runtime;
      GRANT portal_public_reader TO transaction_public;
      GRANT portal_metrics_writer TO transaction_analytics;
      GRANT portal_jobs_worker TO transaction_worker;
      GRANT portal_public_reader,portal_metrics_writer TO transaction_mixed;
      GRANT portal_runtime,transaction_owner TO transaction_table_owner;
      GRANT USAGE ON SCHEMA portal,auth,portal_private TO portal_runtime;
      GRANT USAGE ON SCHEMA portal TO portal_public_reader,portal_public_view_owner;
      GRANT USAGE ON SCHEMA portal_private TO portal_metrics_writer,portal_jobs_worker;
      CREATE TABLE portal.transaction_probe(id uuid PRIMARY KEY,subject uuid,value text);
      ALTER TABLE portal.transaction_probe ENABLE ROW LEVEL SECURITY;
      GRANT SELECT,INSERT ON portal.transaction_probe TO portal_runtime;
      CREATE POLICY transaction_subject ON portal.transaction_probe TO portal_runtime
        USING(subject=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid)
        WITH CHECK(subject=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid);
      CREATE TABLE portal.owner_probe(id integer);
      ALTER TABLE portal.owner_probe OWNER TO transaction_owner;
      CREATE TABLE portal.public_probe(id integer,published boolean,value text);
      INSERT INTO portal.public_probe VALUES(1,true,'public'),(2,false,'draft');
      ALTER TABLE portal.public_probe ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON portal.public_probe TO portal_public_view_owner;
      CREATE POLICY public_probe_policy ON portal.public_probe TO portal_public_view_owner USING(published);
      GRANT CREATE ON SCHEMA portal TO portal_public_view_owner;
      CREATE VIEW portal.public_probe_view WITH(security_barrier=true) AS SELECT id,value FROM portal.public_probe;
      ALTER VIEW portal.public_probe_view OWNER TO portal_public_view_owner;
      REVOKE CREATE ON SCHEMA portal FROM portal_public_view_owner;
      GRANT SELECT ON portal.public_probe_view TO portal_public_reader;
      CREATE TABLE portal.staff_profiles(id uuid PRIMARY KEY,display_name text,role text,active boolean);
      CREATE TABLE portal_private.session_probe(subject uuid,session_id uuid,live boolean);
      ALTER TABLE portal.staff_profiles ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE SQL STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION portal_private.current_staff_role() RETURNS text LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
        SELECT role FROM portal.staff_profiles WHERE id=auth.uid() AND active $$;
      CREATE FUNCTION portal_private.staff_session_is_admitted(p_session uuid) RETURNS boolean LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
        SELECT EXISTS(SELECT 1 FROM portal_private.session_probe WHERE subject=auth.uid() AND session_id=p_session AND live) $$;
      GRANT SELECT ON portal.staff_profiles TO portal_runtime;
      CREATE POLICY staff_profile_probe ON portal.staff_profiles TO portal_runtime USING(
        portal_private.current_staff_role()='ADMIN' OR(id=auth.uid() AND portal_private.current_staff_role() IS NOT NULL));
      CREATE FUNCTION portal_private.record_job_detail_view(uuid,text,text,uuid) RETURNS integer LANGUAGE SQL AS $$ SELECT 0 $$;
      CREATE FUNCTION portal_private.close_expired_jobs(integer,uuid) RETURNS TABLE(processed integer,remaining boolean) LANGUAGE SQL AS $$ SELECT 1,false $$;
      REVOKE ALL ON FUNCTION portal_private.record_job_detail_view(uuid,text,text,uuid),portal_private.close_expired_jobs(integer,uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION portal_private.record_job_detail_view(uuid,text,text,uuid) TO portal_metrics_writer;
      GRANT EXECUTE ON FUNCTION portal_private.close_expired_jobs(integer,uuid) TO portal_jobs_worker;
      CREATE FUNCTION portal_private.revoke_session_probe() RETURNS void LANGUAGE SQL SECURITY DEFINER SET search_path='' AS $$
        UPDATE portal_private.session_probe SET live=false WHERE subject=auth.uid() $$;
      CREATE FUNCTION portal_private.demote_staff_probe() RETURNS void LANGUAGE SQL SECURITY DEFINER SET search_path='' AS $$
        UPDATE portal.staff_profiles SET role='READ_ONLY' WHERE id=auth.uid() $$;
      GRANT EXECUTE ON FUNCTION portal_private.revoke_session_probe(),portal_private.demote_staff_probe() TO portal_runtime;
    `);
  });
  afterEach(async () =>
    db.exec("ROLLBACK; SET SESSION AUTHORIZATION postgres;"),
  );
  after(async () => db?.close());

  function pool() {
    const calls = [];
    let releases = 0;
    return {
      calls,
      get releases() {
        return releases;
      },
      connect: async () => ({
        query: async (sql, values) => {
          calls.push(sql);
          if (!values && /^\s*BEGIN(?: READ ONLY)?;/.test(sql))
            return db.exec(sql);
          return db.query(sql, values);
        },
        release: () => {
          releases++;
        },
      }),
    };
  }
  async function login(name) {
    assert.ok(
      [
        "transaction_runtime",
        "transaction_public",
        "transaction_analytics",
        "transaction_worker",
        "transaction_mixed",
        "transaction_table_owner",
      ].includes(name),
    );
    await db.exec(`SET SESSION AUTHORIZATION ${name}`);
  }
  async function resetContext() {
    const row = (
      await db.query(`SELECT current_user=session_user reset,
      nullif(current_setting('request.jwt.claim.sub',true),'') subject,
      nullif(current_setting('request.jwt.claims',true),'') claims`)
    ).rows[0];
    assert.deepEqual(row, { reset: true, subject: null, claims: null });
  }

  test("reused runtime connections do not retain roles/claims or reveal a previous subject's rows", async () => {
    await login("transaction_runtime");
    const connection = pool(),
      first = randomUUID(),
      second = randomUUID();
    await withRuntime(
      first,
      (client) =>
        client.query(
          "INSERT INTO portal.transaction_probe VALUES($1,$2,'first')",
          [randomUUID(), first],
        ),
      connection,
      randomUUID(),
    );
    assert.equal(connection.calls.length, 4);
    await resetContext();
    await withRuntime(
      second,
      async (client) => {
        assert.deepEqual(
          (await client.query("SELECT * FROM portal.transaction_probe")).rows,
          [],
        );
        const context = (
          await client.query(
            "SELECT current_user name,current_setting('request.jwt.claims')::jsonb claims",
          )
        ).rows[0];
        assert.equal(context.name, "portal_runtime");
        assert.equal(context.claims.sub, second);
      },
      connection,
      randomUUID(),
    );
    await resetContext();
    await withRuntime(
      null,
      async (client) => {
        const context = (
          await client.query(
            "SELECT current_setting('request.jwt.claims')::jsonb claims",
          )
        ).rows[0];
        assert.deepEqual(context.claims, {});
        assert.deepEqual(
          (await client.query("SELECT * FROM portal.transaction_probe")).rows,
          [],
        );
      },
      connection,
    );
    await resetContext();
    assert.equal(connection.releases, 3);
  });

  test("business failure rolls back writes and clears context before connection reuse", async () => {
    const id = randomUUID(),
      subject = randomUUID(),
      connection = pool();
    await login("transaction_runtime");
    await assert.rejects(
      withRuntime(
        subject,
        async (client) => {
          await client.query(
            "INSERT INTO portal.transaction_probe VALUES($1,$2,'rollback')",
            [id, subject],
          );
          throw new Error("abort operation");
        },
        connection,
      ),
      /abort operation/,
    );
    await resetContext();
    assert.equal(connection.releases, 1);
    await db.exec("SET SESSION AUTHORIZATION postgres");
    assert.equal(
      (
        await db.query(
          "SELECT EXISTS(SELECT 1 FROM portal.transaction_probe WHERE id=$1) yes",
          [id],
        )
      ).rows[0].yes,
      false,
    );
  });

  test("public setup keeps read-only mode, view RLS and role separation", async () => {
    await login("transaction_public");
    const connection = pool();
    assert.deepEqual(
      await withPublicReader(
        async (client) =>
          (await client.query("SELECT * FROM portal.public_probe_view")).rows,
        connection,
      ),
      [{ id: 1, value: "public" }],
    );
    assert.equal(connection.calls.length, 3);
    await resetContext();
    await assert.rejects(
      withPublicReader(
        (client) =>
          client.query("CREATE TABLE public.forbidden_probe(id integer)"),
        connection,
      ),
      { code: "25006" },
    );
    await resetContext();
    await assert.rejects(
      withPublicReader(
        (client) => client.query("SELECT * FROM portal.public_probe"),
        connection,
      ),
      { code: "42501" },
    );
    await resetContext();
  });

  test("privileged/owner/mixed and no-longer-authorized logins cannot reach business code", async () => {
    const invoke = async (run) => assert.rejects(run);
    await invoke(() =>
      withRuntime(
        null,
        async () => assert.fail("superuser must be rejected"),
        pool(),
      ),
    );
    await login("transaction_table_owner");
    await invoke(() =>
      withRuntime(
        null,
        async () => assert.fail("table owner must be rejected"),
        pool(),
      ),
    );
    await db.exec("SET SESSION AUTHORIZATION postgres");
    await login("transaction_mixed");
    await invoke(() =>
      withPublicReader(
        async () => assert.fail("mixed roles must be rejected"),
        pool(),
      ),
    );
    await invoke(() =>
      incrementDetailView(randomUUID(), "en", "direct", randomUUID(), pool()),
    );
    await db.exec(
      "SET SESSION AUTHORIZATION postgres; REVOKE portal_runtime FROM transaction_runtime;",
    );
    try {
      await login("transaction_runtime");
      await assert.rejects(
        withRuntime(
          null,
          async () => assert.fail("revoked membership"),
          pool(),
        ),
        { status: 503 },
      );
      await resetContext();
    } finally {
      await db.exec(
        "SET SESSION AUTHORIZATION postgres; GRANT portal_runtime TO transaction_runtime;",
      );
    }
  });

  test("analytics and expiry workers retain their execute-only roles", async () => {
    await login("transaction_analytics");
    const analytics = pool();
    assert.equal(
      await incrementDetailView(
        randomUUID(),
        "en",
        "direct",
        randomUUID(),
        analytics,
      ),
      0,
    );
    assert.equal(analytics.calls.length, 3);
    await resetContext();
    await db.exec("SET SESSION AUTHORIZATION postgres");
    await login("transaction_worker");
    const worker = pool();
    assert.equal((await closeExpiredJobs(worker)).processed, 1);
    assert.equal(worker.calls.length, 4);
    await resetContext();
  });

  test("one-statement staff checks distinguish revoked sessions, inactive profiles and role changes", async () => {
    const subject = randomUUID(),
      sessionId = randomUUID(),
      identity = { subject, sessionId, token: "verified" };
    await db.query(
      "INSERT INTO portal.staff_profiles VALUES($1,'Staff','ADMIN',true)",
      [subject],
    );
    await db.query(
      "INSERT INTO portal_private.session_probe VALUES($1,$2,true)",
      [subject, sessionId],
    );
    await login("transaction_runtime");
    await withRuntime(
      subject,
      async (client) => {
        assert.deepEqual(
          await staffInTransaction(client, identity, ["ADMIN"]),
          { id: subject, displayName: "Staff", role: "ADMIN" },
        );
      },
      pool(),
      sessionId,
    );
    await db.exec("SET SESSION AUTHORIZATION postgres");
    await db.query(
      "UPDATE portal.staff_profiles SET role='READ_ONLY' WHERE id=$1",
      [subject],
    );
    await login("transaction_runtime");
    await assert.rejects(
      withRuntime(
        subject,
        (client) => staffInTransaction(client, identity, ["ADMIN"]),
        pool(),
        sessionId,
      ),
      { status: 403 },
    );
    await db.exec("SET SESSION AUTHORIZATION postgres");
    await db.query(
      "UPDATE portal.staff_profiles SET active=false WHERE id=$1",
      [subject],
    );
    await login("transaction_runtime");
    await assert.rejects(
      withRuntime(
        subject,
        (client) => staffInTransaction(client, identity),
        pool(),
        sessionId,
      ),
      { status: 403 },
    );
    await db.exec("SET SESSION AUTHORIZATION postgres");
    await db.query(
      "UPDATE portal_private.session_probe SET live=false WHERE subject=$1",
      [subject],
    );
    await login("transaction_runtime");
    await assert.rejects(
      withRuntime(
        subject,
        (client) => staffInTransaction(client, identity),
        pool(),
        sessionId,
      ),
      { status: 401 },
    );
    await resetContext();
  });

  test("staffRead rejects data when admission changes after its first authorization check", async () => {
    const subject = randomUUID(),
      sessionId = randomUUID();
    const identity = { subject, sessionId, token: "verified" };
    await db.query(
      "INSERT INTO portal.staff_profiles VALUES($1,'Staff','ADMIN',true)",
      [subject],
    );
    await db.query(
      "INSERT INTO portal_private.session_probe VALUES($1,$2,true)",
      [subject, sessionId],
    );
    await login("transaction_runtime");
    const connection = pool();
    await assert.rejects(
      staffRead(
        identity,
        ["ADMIN"],
        async (client) => {
          await client.query("SELECT portal_private.revoke_session_probe()");
          return "private response must not escape";
        },
        connection,
      ),
      { status: 401 },
    );
    assert.equal(connection.calls.length, 6);
    assert.equal(
      connection.calls.filter((sql) =>
        sql.includes("staff_session_is_admitted"),
      ).length,
      2,
    );
    await resetContext();
  });

  test("staffRead rechecks permission changes before returning its result", async () => {
    const subject = randomUUID(),
      sessionId = randomUUID();
    const identity = { subject, sessionId, token: "verified" };
    await db.query(
      "INSERT INTO portal.staff_profiles VALUES($1,'Staff','ADMIN',true)",
      [subject],
    );
    await db.query(
      "INSERT INTO portal_private.session_probe VALUES($1,$2,true)",
      [subject, sessionId],
    );
    await login("transaction_runtime");
    await assert.rejects(
      staffRead(
        identity,
        ["ADMIN"],
        async (client) => {
          await client.query("SELECT portal_private.demote_staff_probe()");
          return "private response must not escape";
        },
        pool(),
      ),
      { status: 403 },
    );
    await resetContext();
  });
});
