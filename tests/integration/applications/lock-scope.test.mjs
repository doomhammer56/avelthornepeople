import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
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

function original(migration, name) {
  const match = readFileSync(
    `prisma/migrations/${migration}/migration.sql`,
    "utf8",
  ).match(
    new RegExp(
      `CREATE (?:OR REPLACE )?FUNCTION portal_private\\.${name}\\([\\s\\S]*?\\$\\$;`,
    ),
  );
  assert.ok(match, name);
  return match[0];
}
const recruitment = "20261025000400_application_management";
describe("Recruitment lock scope (isolated PostgreSQL; single session)", () => {
  let db;
  const actor = randomUUID(),
    job = randomUUID(),
    one = randomUUID(),
    two = randomUUID(),
    app = randomUUID();
  before(async () => {
    db = new PGlite();
    await db.exec(`CREATE SCHEMA portal; CREATE SCHEMA portal_private;
      CREATE ROLE portal_recruitment_owner NOLOGIN NOBYPASSRLS;
      CREATE TABLE portal.staff_profiles(id uuid PRIMARY KEY,role text,active boolean);
      CREATE TABLE portal.candidates(id uuid PRIMARY KEY,merged_into_id uuid REFERENCES portal.candidates,version integer DEFAULT 1,
        name_encrypted bytea,email_encrypted bytea,phone_encrypted bytea,email_hmac bytea,phone_hmac bytea,hmac_key_version integer,deletion_requested_at timestamptz);
      CREATE TABLE portal.deletion_requests(id uuid DEFAULT gen_random_uuid(),candidate_id uuid,state text);
      CREATE TABLE portal.jobs(id uuid PRIMARY KEY);
      CREATE VIEW portal.visible_jobs AS SELECT id FROM portal.jobs;
      CREATE TABLE portal.uploads(id uuid PRIMARY KEY,capability_hash bytea,intake_job_id uuid,intake_request_id uuid,access_revoked_at timestamptz,
        capability_expires_at timestamptz,scan_state text,declared_size_bytes bigint,object_key text,size_bytes bigint,sha256 bytea,detected_type text);
      CREATE TABLE portal.applications(id uuid PRIMARY KEY,job_id uuid,candidate_id uuid,version integer DEFAULT 1,status text DEFAULT 'NEW',
        cv_upload_id uuid,cv_scan_state text,intake_state text,profile_encrypted bytea,cover_letter_encrypted bytea,consent_at timestamptz,policy_version text,
        source text,submission_channel text,locale text,duplicate_candidate_match boolean,idempotency_key uuid,payload_digest bytea,receipt_hash bytea,receipt_expires_at timestamptz,confirmed_at timestamptz,
        UNIQUE(job_id,idempotency_key));
      CREATE TABLE portal.audit_logs(actor_id uuid,object_type text,object_id uuid,action text,safe_changes jsonb,request_id uuid);
      CREATE TABLE portal.outbox_events(event_type text,aggregate_id uuid,delivery_key text UNIQUE,safe_references jsonb);
      CREATE TABLE portal_private.recruitment_commands(request_id uuid PRIMARY KEY,actor_id uuid,command jsonb,result jsonb);
      CREATE FUNCTION portal_private.staff_session_is_admitted(uuid) RETURNS boolean LANGUAGE SQL AS $$ SELECT current_setting('test.admitted',true)='yes' $$;
      ${original(recruitment, "lock_candidate_identity")}
      ${original(recruitment, "candidate_group_blocked")}
      ${original(recruitment, "candidate_version_guard")}
      ${original("20261025000600_candidate_attachment_integrity", "canonical_application_candidate")}
      ${original(recruitment, "manage_recruitment")}
      ${original("20261026000400_public_application_intake", "accept_application")}
      CREATE TRIGGER candidate_identity_lock BEFORE INSERT OR UPDATE OR DELETE ON portal.candidates FOR EACH STATEMENT EXECUTE FUNCTION portal_private.lock_candidate_identity();
      CREATE TRIGGER application_identity_lock BEFORE INSERT OR UPDATE OF candidate_id OR DELETE ON portal.applications FOR EACH STATEMENT EXECUTE FUNCTION portal_private.lock_candidate_identity();
      CREATE TRIGGER deletion_identity_lock BEFORE INSERT OR UPDATE OR DELETE ON portal.deletion_requests FOR EACH STATEMENT EXECUTE FUNCTION portal_private.lock_candidate_identity();
      CREATE TRIGGER candidate_version_guard BEFORE UPDATE ON portal.candidates FOR EACH ROW EXECUTE FUNCTION portal_private.candidate_version_guard();
      CREATE TRIGGER canonical_application_candidate BEFORE INSERT OR UPDATE OF candidate_id ON portal.applications FOR EACH ROW EXECUTE FUNCTION portal_private.canonical_application_candidate();
    `);
    // Changing the function definitions must preserve their existing owner and
    // invoker grants. The full admission/RLS guards have separate SQL suites.
    await db.exec(`CREATE ROLE portal_runtime NOLOGIN;
      GRANT USAGE ON SCHEMA portal,portal_private TO portal_recruitment_owner,portal_runtime;
      GRANT ALL ON ALL TABLES IN SCHEMA portal,portal_private TO portal_recruitment_owner;
      ALTER FUNCTION portal_private.manage_recruitment(text,uuid,integer,uuid,text,uuid,integer) OWNER TO portal_recruitment_owner;
      REVOKE ALL ON FUNCTION portal_private.manage_recruitment(text,uuid,integer,uuid,text,uuid,integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION portal_private.manage_recruitment(text,uuid,integer,uuid,text,uuid,integer) TO portal_runtime;`);
    await db.exec(
      readFileSync(
        "prisma/migrations/20261028000100_recruitment_lock_scope/migration.sql",
        "utf8",
      ),
    );
  });
  after(async () => db?.close());
  beforeEach(async () => {
    await db.exec(
      "TRUNCATE portal.candidates,portal.applications,portal.deletion_requests,portal.jobs,portal.uploads,portal.staff_profiles,portal.audit_logs,portal.outbox_events,portal_private.recruitment_commands;",
    );
    await db.query(
      "INSERT INTO portal.staff_profiles VALUES($1,'ADMIN',true)",
      [actor],
    );
    await db.query("INSERT INTO portal.jobs VALUES($1)", [job]);
    await db.query("INSERT INTO portal.candidates(id) VALUES($1),($2)", [
      one,
      two,
    ]);
    await db.query(
      "INSERT INTO portal.applications(id,job_id,candidate_id,intake_state) VALUES($1,$2,$3,'CONFIRMED')",
      [app, job, two],
    );
    await db.exec("BEGIN");
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('test.admitted','yes',true)",
      [actor],
    );
  });
  afterEach(async () => db.exec("ROLLBACK"));
  async function modes() {
    return (
      await db.query(
        "SELECT mode FROM pg_locks WHERE locktype='advisory' AND classid=72705 AND objid=1 AND objsubid=2",
      )
    ).rows.map((r) => r.mode);
  }
  async function command(
    kind,
    id,
    version,
    request,
    status = null,
    source = null,
    sourceVersion = null,
  ) {
    return (
      await db.query(
        "SELECT portal_private.manage_recruitment($1,$2,$3,$4,$5,$6,$7) result",
        [kind, id, version, request, status, source, sourceVersion],
      )
    ).rows[0].result;
  }
  async function rejects(action, code) {
    await db.exec("SAVEPOINT failure");
    try {
      await assert.rejects(action, { code });
    } finally {
      await db.exec("ROLLBACK TO SAVEPOINT failure; RELEASE SAVEPOINT failure");
    }
  }
  test("Stage changes hold a shared identity gate and preserve version/replay/audit checks", async () => {
    const request = randomUUID();
    const result = await command("stage", app, 1, request, "SCREENING");
    assert.deepEqual(await modes(), ["ShareLock"]);
    assert.equal(result.version, 2);
    assert.deepEqual(
      await command("stage", app, 1, request, "SCREENING"),
      result,
    );
    await rejects(() => command("stage", app, 1, request, "OFFER"), "40001");
    await rejects(
      () => command("stage", app, 1, randomUUID(), "OFFER"),
      "40001",
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM portal.audit_logs")).rows[0]
        .n,
      1,
    );
  });
  test("Merges retain the exclusive gate, move applications and keep alias versions coherent", async () => {
    const result = await command("merge", one, 1, randomUUID(), null, two, 1);
    assert.deepEqual(await modes(), ["ExclusiveLock"]);
    assert.equal(result.applicationsMoved, 1);
    assert.equal(
      (
        await db.query(
          "SELECT candidate_id FROM portal.applications WHERE id=$1",
          [app],
        )
      ).rows[0].candidate_id,
      one,
    );
    assert.equal(
      (
        await db.query(
          "SELECT merged_into_id FROM portal.candidates WHERE id=$1",
          [two],
        )
      ).rows[0].merged_into_id,
      one,
    );
  });
  test("Deletion and direct identity mutations retain exclusion; blocked groups reject commands", async () => {
    await db.query(
      "INSERT INTO portal.deletion_requests(candidate_id,state) VALUES($1,'PENDING')",
      [two],
    );
    assert.deepEqual(await modes(), ["ExclusiveLock"]);
    await rejects(
      () => command("stage", app, 1, randomUUID(), "OFFER"),
      "55000",
    );
    await rejects(
      () => command("merge", one, 1, randomUUID(), null, two, 1),
      "40001",
    );
  });
  async function intake(
    keys,
    request = randomUUID(),
    digest = randomBytes(32),
  ) {
    const upload = randomUUID(),
      candidate = randomUUID(),
      application = randomUUID(),
      cap = randomBytes(32);
    await db.query(
      "INSERT INTO portal.uploads(id,capability_hash,intake_job_id,intake_request_id,capability_expires_at,scan_state,declared_size_bytes,object_key) VALUES($1,$2,$3,$4,now()+interval '1 hour','PENDING',100,$5)",
      [upload, cap, job, request, `${upload}/${randomUUID()}.pdf`],
    );
    const values = [
      job,
      request,
      upload,
      cap,
      "application/pdf",
      100,
      randomBytes(32),
      application,
      Buffer.from("profile"),
      null,
      "en",
      digest,
      candidate,
      Buffer.from("name"),
      Buffer.from("email"),
      Buffer.from("phone"),
      JSON.stringify(keys),
      1,
    ];
    const run = () =>
      db.query(
        `SELECT portal_private.accept_application(${values.map((_, i) => "$" + (i + 1)).join(",")}) result`,
        values,
      );
    return { run, application, candidate, values };
  }
  test("Intake holds only a shared gate plus per-request/contact locks across all HMAC versions", async () => {
    const keys = [1, 2].flatMap((version) =>
      ["email", "phone"].map((field) => ({
        version,
        field,
        hash: randomBytes(32).toString("hex"),
      })),
    );
    const f = await intake(keys);
    assert.equal((await f.run()).rows[0].result, "accepted");
    assert.deepEqual(await modes(), ["ShareLock"]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND objsubid=1",
        )
      ).rows[0].n,
      5,
    );
    assert.equal((await f.run()).rows[0].result, "duplicate");
    const second = await intake(keys);
    assert.equal((await second.run()).rows[0].result, "accepted");
    const ids = (
      await db.query(
        "SELECT candidate_id FROM portal.applications WHERE id=ANY($1)",
        [[f.application, second.application]],
      )
    ).rows;
    assert.equal(new Set(ids.map((r) => r.candidate_id)).size, 1);
    f.values[11] = randomBytes(32);
    await rejects(f.run, "40001");
    await db.query(
      "INSERT INTO portal.deletion_requests(candidate_id,state) VALUES($1,'PENDING')",
      [f.candidate],
    );
    const blocked = await intake(keys);
    await rejects(blocked.run, "55000");
  });
  test("Migration preserves command ownership/grants and refuses direct runtime helper execution", async () => {
    const [row] = (
      await db.query(
        "SELECT pg_get_userbyid(proowner) owner,has_function_privilege('portal_runtime',oid,'EXECUTE') allowed FROM pg_proc WHERE proname='manage_recruitment'",
      )
    ).rows;
    assert.equal(row.owner, "portal_recruitment_owner");
    assert.equal(row.allowed, true);
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('portal_runtime','portal_private.lock_candidate_insert_contacts()','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  });
});
