import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  test,
} from "node:test";
import { PGlite } from "@electric-sql/pglite";

function existingFunction(migration, name) {
  const source = readFileSync(
    `prisma/migrations/${migration}/migration.sql`,
    "utf8",
  );
  const statement = source.match(
    new RegExp(
      `CREATE (?:OR REPLACE )?FUNCTION portal_private\\.${name}\\([\\s\\S]*?\\$\\$;`,
    ),
  );
  assert.ok(statement, `Missing original function: ${name}`);
  return statement[0];
}

describe("Admin staff directory (isolated PostgreSQL)", () => {
  let db;
  before(async () => {
    db = new PGlite();
    await db.exec(`CREATE SCHEMA portal; CREATE SCHEMA portal_private; CREATE SCHEMA auth;
      CREATE ROLE portal_runtime NOLOGIN NOBYPASSRLS;
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN; CREATE ROLE portal_public_reader NOLOGIN;
      CREATE ROLE portal_metrics_writer NOLOGIN; CREATE ROLE portal_jobs_worker NOLOGIN;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email varchar(255),last_sign_in_at timestamptz,
        banned_until timestamptz,encrypted_password text,raw_user_meta_data jsonb);
      CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,not_after timestamptz,created_at timestamptz);
      CREATE TABLE portal.staff_profiles(id uuid PRIMARY KEY,display_name text,role text,active boolean,
        version integer DEFAULT 1,created_at timestamptz DEFAULT now());
      CREATE TABLE portal_private.staff_provider_operations(id uuid PRIMARY KEY,profile_id uuid,
        operation text DEFAULT 'ban',completed_at timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE portal_private.staff_session_cutoffs(profile_id uuid,revoked_before timestamptz);
      CREATE TABLE portal_private.staff_session_admissions(session_id uuid,subject_id uuid,expires_at timestamptz);
      CREATE TABLE portal.audit_logs(actor_id uuid,object_type text,object_id uuid,action text,safe_changes jsonb,request_id uuid);
      CREATE TABLE portal.outbox_events(event_type text,aggregate_id uuid,delivery_key text UNIQUE,safe_references jsonb);
      ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal.staff_profiles ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal_private.staff_provider_operations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal_private.staff_session_cutoffs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal_private.staff_session_admissions ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA auth,portal,portal_private TO portal_runtime;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE SQL STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      ${existingFunction("20261019000100_rls_query_boundaries", "current_staff_role")}
      ${existingFunction("20261020000100_staff_auth", "staff_session_is_live")}
      ${existingFunction("20261021000100_admin_login_lockout", "staff_session_is_admitted")}
      ${existingFunction("20261021000100_admin_login_lockout", "require_staff_admin")}
      ${existingFunction("20261020000100_staff_auth", "complete_staff_provider_operation")}
      ${existingFunction("20261026000100_administrative_audit", "audit_provider_completion")}
      CREATE TRIGGER staff_provider_audit AFTER UPDATE OF completed_at ON portal_private.staff_provider_operations
        FOR EACH ROW EXECUTE FUNCTION portal_private.audit_provider_completion();
    `);
    for (const name of [
      "20261027000700_staff_directory",
      "20261027000800_staff_directory_pending_index",
      "20261028000200_staff_provider_claims",
    ])
      await db.exec(
        readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
  });
  after(async () => db?.close());
  beforeEach(async () => db.exec("BEGIN"));
  afterEach(async () => db.exec("ROLLBACK"));

  async function account(
    role = "ADMIN",
    {
      active = true,
      admitted = true,
      email = "synthetic@example.invalid",
      createdAt = "2026-01-01T00:00:00Z",
    } = {},
  ) {
    const id = randomUUID(),
      sessionId = randomUUID();
    await db.query(
      "INSERT INTO auth.users VALUES($1,$2,'2026-10-27T07:10:11Z',NULL,'never-return-password',$3)",
      [
        id,
        email,
        JSON.stringify({ role: "ADMIN", secret: "never-return-metadata" }),
      ],
    );
    await db.query(
      "INSERT INTO portal.staff_profiles(id,display_name,role,active,created_at) VALUES($1,'Staff',$2,$3,$4)",
      [id, role, active, createdAt],
    );
    await db.query(
      "INSERT INTO auth.sessions VALUES($1,$2,now()+interval '1 hour',now()-interval '1 minute')",
      [sessionId, id],
    );
    if (admitted)
      await db.query(
        "INSERT INTO portal_private.staff_session_admissions VALUES($1,$2,now()+interval '1 hour')",
        [sessionId, id],
      );
    return { id, sessionId };
  }
  async function read(identity, page = 1, metadata = {}) {
    await db.exec("SAVEPOINT directory_request");
    try {
      await db.query(
        "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
        [
          identity?.id ?? "",
          JSON.stringify({ session_id: identity?.sessionId, ...metadata }),
        ],
      );
      await db.exec("SET LOCAL ROLE portal_runtime");
      return (
        await db.query("SELECT * FROM portal_private.read_staff_accounts($1)", [
          page,
        ])
      ).rows;
    } finally {
      await db.exec(
        "ROLLBACK TO SAVEPOINT directory_request; RELEASE SAVEPOINT directory_request",
      );
    }
  }

  test("an admitted Admin receives a bounded, ordered page with only the intended identity fields", async () => {
    const admin = await account();
    for (let i = 0; i < 53; i++)
      await account("READ_ONLY", {
        createdAt: `2026-02-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      });
    const unlinked = randomUUID();
    await db.query(
      "INSERT INTO auth.users(id,email,encrypted_password) VALUES($1,'unlinked@example.invalid','never-return-password')",
      [unlinked],
    );
    const first = await read(admin);
    const second = await read(admin, 2);
    assert.equal(first.length, 51);
    assert.equal(second.length, 4);
    assert.equal(
      new Set([...first.slice(0, 50), ...second].map((row) => row.id)).size,
      54,
    );
    assert.equal(first[0].id, admin.id);
    assert.ok(!first.some((row) => row.id === unlinked));
    assert.deepEqual(
      Object.keys(first[0]).sort(),
      [
        "id",
        "display_name",
        "role",
        "active",
        "version",
        "provider_id",
        "email",
        "last_sign_in_at",
        "pending_operation_id",
      ].sort(),
    );
    assert.equal(JSON.stringify(first).includes("never-return"), false);
    assert.deepEqual(await read(admin, 10000), []);
  });

  test("pending synchronization selects the oldest incomplete operation and identities stay fresh", async () => {
    const admin = await account();
    const target = await account("HR");
    const oldest = randomUUID();
    await db.query(
      `INSERT INTO portal_private.staff_provider_operations(id,profile_id,completed_at,created_at) VALUES
      ($1,$2,NULL,now()-interval '2 hours'),($3,$2,NULL,now()-interval '1 hour'),($4,$2,now(),now()-interval '3 hours')`,
      [oldest, target.id, randomUUID(), randomUUID()],
    );
    assert.equal(
      (await read(admin)).find((row) => row.id === target.id)
        .pending_operation_id,
      oldest,
    );
    await db.query(
      "UPDATE auth.users SET email='changed@example.invalid',last_sign_in_at='2026-10-27T08:00:00Z' WHERE id=$1",
      [target.id],
    );
    const fresh = (await read(admin)).find((row) => row.id === target.id);
    assert.equal(fresh.email, "changed@example.invalid");
    assert.equal(
      new Date(fresh.last_sign_in_at).toISOString(),
      "2026-10-27T08:00:00.000Z",
    );
    await db.query(
      `INSERT INTO portal_private.staff_provider_operations(id,profile_id,completed_at,created_at)
      SELECT gen_random_uuid(),$1,now(),now() FROM generate_series(1,5000)`,
      [target.id],
    );
    await db.exec("ANALYZE portal_private.staff_provider_operations");
    const plan = await db.query(
      `EXPLAIN (FORMAT JSON) SELECT id FROM portal_private.staff_provider_operations
      WHERE profile_id=$1 AND completed_at IS NULL ORDER BY created_at,id LIMIT 1`,
      [target.id],
    );
    assert.ok(
      JSON.stringify(plan.rows).includes(
        "staff_provider_operations_pending_profile_idx",
      ),
    );
  });

  test("HR, Read-Only, inactive Admins and forged metadata cannot read the directory", async () => {
    for (const role of ["HR", "READ_ONLY"]) {
      const user = await account(role);
      await assert.rejects(
        read(user, 1, { role: "ADMIN", user_metadata: { role: "ADMIN" } }),
        { code: "42501" },
      );
    }
    await assert.rejects(read(await account("ADMIN", { active: false })), {
      code: "42501",
    });
    await assert.rejects(read(null), { code: "42501" });
  });

  test("admission, session expiry, revocation cutoff, provider bans and pending sync are checked live", async () => {
    const admin = await account();
    const other = await account();
    await assert.rejects(read({ id: admin.id, sessionId: other.sessionId }), {
      code: "42501",
    });
    await assert.rejects(read(await account("ADMIN", { admitted: false })), {
      code: "42501",
    });
    for (const sql of [
      "UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE user_id=$1",
      "UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=$1",
      "INSERT INTO portal_private.staff_session_cutoffs VALUES($1,now())",
      "INSERT INTO portal_private.staff_provider_operations(id,profile_id) VALUES(gen_random_uuid(),$1)",
      "UPDATE portal_private.staff_session_admissions SET expires_at=now()-interval '1 second' WHERE subject_id=$1",
    ]) {
      await db.exec("SAVEPOINT revoke_admin");
      try {
        await db.query(sql, [admin.id]);
        await assert.rejects(read(admin), { code: "42501" });
      } finally {
        await db.exec(
          "ROLLBACK TO SAVEPOINT revoke_admin; RELEASE SAVEPOINT revoke_admin",
        );
      }
    }
  });

  async function provider(identity, sql, values) {
    await db.exec("SAVEPOINT provider_request");
    try {
      await db.query(
        "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
        [identity.id, JSON.stringify({ session_id: identity.sessionId })],
      );
      await db.exec("SET LOCAL ROLE portal_runtime");
      const result = await db.query(sql, values);
      await db.exec("RESET ROLE; RELEASE SAVEPOINT provider_request");
      return result.rows;
    } catch (error) {
      await db.exec(
        "ROLLBACK TO SAVEPOINT provider_request; RELEASE SAVEPOINT provider_request",
      );
      throw error;
    }
  }
  const claimSql =
    "SELECT * FROM portal_private.claim_staff_provider_operation($1,$2)";
  const finishSql =
    "SELECT portal_private.finish_staff_provider_claim($1,$2,$3)";
  async function pendingOperation(target) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO portal_private.staff_provider_operations(id,profile_id) VALUES($1,$2)",
      [id, target.id],
    );
    return id;
  }
  test("Provider claims admit only an Admin and fence duplicate/stale completions", async () => {
    const admin = await account(),
      hr = await account("HR"),
      target = await account("READ_ONLY", { active: false });
    const op = await pendingOperation(target),
      claim = randomUUID();
    await assert.rejects(() => provider(hr, claimSql, [op, claim]), {
      code: "42501",
    });
    const [first] = await provider(admin, claimSql, [op, claim]);
    assert.deepEqual(first, {
      profile_id: target.id,
      operation: "ban",
      state: "claimed",
    });
    assert.equal(
      (await provider(admin, claimSql, [op, randomUUID()]))[0].state,
      "pending",
    );
    await assert.rejects(
      () =>
        provider(
          admin,
          "SELECT portal_private.complete_staff_provider_operation($1)",
          [op],
        ),
      { code: "42501" },
    );
    await assert.rejects(
      () => provider(admin, finishSql, [op, randomUUID(), true]),
      { code: "40001" },
    );
    await provider(admin, finishSql, [op, claim, true]);
    await provider(admin, finishSql, [op, claim, true]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM portal.audit_logs WHERE request_id=$1 AND action='STAFF_PROVIDER_SYNCED'",
          [op],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM portal.outbox_events WHERE delivery_key=$1",
          ["staff-sync:" + op],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (await provider(admin, claimSql, [op, randomUUID()]))[0].state,
      "complete",
    );
    assert.equal(
      (await provider(admin, claimSql, [randomUUID(), randomUUID()]))[0].state,
      "complete",
    );
  });
  test("Known rejection can release a claim; uncertain or abandoned claims never expire automatically", async () => {
    const admin = await account(),
      target = await account("READ_ONLY", { active: false });
    const op = await pendingOperation(target),
      first = randomUUID(),
      second = randomUUID();
    await provider(admin, claimSql, [op, first]);
    await provider(admin, finishSql, [op, first, false]);
    assert.equal(
      (await provider(admin, claimSql, [op, second]))[0].state,
      "claimed",
    );
    await db.query(
      "UPDATE portal_private.staff_provider_operations SET claimed_at=now()-interval '30 days' WHERE id=$1",
      [op],
    );
    assert.equal(
      (await provider(admin, claimSql, [op, randomUUID()]))[0].state,
      "pending",
    );
    await assert.rejects(() => provider(admin, finishSql, [op, first, true]), {
      code: "40001",
    });
    await db.query(
      "UPDATE portal.staff_profiles SET version=version+1,active=true WHERE id=$1",
      [target.id],
    );
    await assert.rejects(() => provider(admin, finishSql, [op, second, true]), {
      code: "40001",
    });
  });
  test("Provider claims check operation ordering and fresh admission at completion", async () => {
    const admin = await account(),
      target = await account("READ_ONLY", { active: false });
    const old = await pendingOperation(target),
      recent = await pendingOperation(target);
    await db.query(
      "UPDATE portal_private.staff_provider_operations SET created_at=now()-interval '1 hour' WHERE id=$1",
      [old],
    );
    assert.equal(
      (await provider(admin, claimSql, [recent, randomUUID()]))[0].state,
      "pending",
    );
    const token = randomUUID();
    await provider(admin, claimSql, [old, token]);
    await db.query(
      "DELETE FROM portal_private.staff_session_admissions WHERE session_id=$1",
      [admin.sessionId],
    );
    await assert.rejects(() => provider(admin, finishSql, [old, token, true]), {
      code: "42501",
    });
    assert.equal(
      (
        await db.query(
          "SELECT completed_at FROM portal_private.staff_provider_operations WHERE id=$1",
          [old],
        )
      ).rows[0].completed_at,
      null,
    );
  });

  test("input limits and grants prevent broad identity access", async () => {
    const admin = await account();
    for (const page of [null, 0, -1, 10001])
      await assert.rejects(read(admin, page), { code: "22023" });
    const rights = (
      await db.query(`SELECT
      has_function_privilege('portal_runtime','portal_private.read_staff_accounts(integer)','EXECUTE') callable,
      has_table_privilege('portal_runtime','auth.users','SELECT') auth_read,
      has_table_privilege('portal_runtime','auth.sessions','SELECT') sessions_read,
      has_table_privilege('portal_runtime','portal_private.staff_provider_operations','SELECT') operations_read,
      p.prosecdef,p.proconfig,
      p.proowner=(SELECT proowner FROM pg_proc WHERE oid='portal_private.require_staff_admin()'::regprocedure) established_owner
      FROM pg_proc p WHERE oid='portal_private.read_staff_accounts(integer)'::regprocedure`)
    ).rows[0];
    assert.equal(rights.callable, true);
    assert.equal(rights.auth_read, false);
    assert.equal(rights.sessions_read, false);
    assert.equal(rights.operations_read, false);
    assert.equal(rights.prosecdef, true);
    assert.equal(rights.established_owner, true);
    assert.ok(rights.proconfig.includes('search_path=""'));
    for (const role of [
      "anon",
      "authenticated",
      "service_role",
      "portal_public_reader",
      "portal_metrics_writer",
      "portal_jobs_worker",
    ])
      assert.equal(
        (
          await db.query(
            "SELECT has_function_privilege($1,'portal_private.read_staff_accounts(integer)','EXECUTE') callable",
            [role],
          )
        ).rows[0].callable,
        false,
      );
  });
});
