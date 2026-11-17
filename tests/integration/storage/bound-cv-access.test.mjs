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

const original = readFileSync(
  "prisma/migrations/20261026000400_public_application_intake/migration.sql",
  "utf8",
).match(
  /CREATE OR REPLACE FUNCTION portal_private\.record_cv_access\([\s\S]*?END \$\$;/,
)[0];

describe("Descriptor-bound CV audit (isolated PostgreSQL)", () => {
  let db;
  before(async () => {
    db = new PGlite();
    await db.exec(`CREATE SCHEMA portal; CREATE SCHEMA portal_private; CREATE SCHEMA auth;
      CREATE ROLE portal_recruitment_owner NOLOGIN NOBYPASSRLS;
      CREATE ROLE portal_runtime NOLOGIN NOBYPASSRLS;
      CREATE TABLE portal.uploads (
        id uuid PRIMARY KEY,object_key text,sha256 bytea,detected_type text,size_bytes bigint,
        storage_provider text,bucket text,scan_state text,access_revoked_at timestamptz
      );
      CREATE TABLE portal.applications(id uuid PRIMARY KEY,cv_upload_id uuid,candidate_id uuid,intake_state text);
      CREATE TABLE portal.audit_logs(actor_id uuid,object_type text,object_id uuid,action text,safe_changes jsonb,request_id uuid);
      ALTER TABLE portal.uploads ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal.applications ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA portal,portal_private TO portal_recruitment_owner;
      GRANT USAGE ON SCHEMA portal_private TO portal_runtime;
      GRANT SELECT,UPDATE ON portal.uploads TO portal_recruitment_owner;
      GRANT SELECT ON portal.applications TO portal_recruitment_owner;
      CREATE POLICY bound_upload_owner ON portal.uploads TO portal_recruitment_owner USING(true);
      CREATE POLICY bound_application_owner ON portal.applications TO portal_recruitment_owner USING(true);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE SQL AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
      CREATE FUNCTION portal_private.current_staff_role() RETURNS text LANGUAGE SQL AS $$ SELECT current_setting('test.role',true) $$;
      CREATE FUNCTION portal_private.candidate_group_blocked(uuid) RETURNS boolean LANGUAGE SQL AS $$ SELECT current_setting('test.blocked',true)='yes' $$;
      CREATE FUNCTION portal_private.staff_session_is_admitted(uuid) RETURNS boolean LANGUAGE SQL AS $$ SELECT current_setting('test.live',true)='yes' $$;
      ${original}
      REVOKE ALL ON FUNCTION portal_private.record_cv_access(uuid,uuid) FROM PUBLIC;
    `);
    await db.exec(
      readFileSync(
        "prisma/migrations/20261027000600_bound_cv_access/migration.sql",
        "utf8",
      ),
    );
  });
  after(async () => db?.close());
  beforeEach(async () => {
    await db.exec(
      "BEGIN; SET LOCAL test.role='HR'; SET LOCAL test.live='yes'; SET LOCAL test.blocked='no'",
    );
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ session_id: randomUUID() }),
    ]);
  });
  afterEach(async () => db.exec("ROLLBACK"));

  async function fixture() {
    const id = randomUUID(),
      uploadId = randomUUID(),
      sha = randomBytes(32),
      key = `${uploadId}/${randomUUID()}.pdf`;
    await db.query(
      "INSERT INTO portal.uploads VALUES($1,$2,$3,'application/pdf',100,'SUPABASE','cv-quarantine','UNSCANNED',NULL)",
      [uploadId, key, sha],
    );
    await db.query(
      "INSERT INTO portal.applications VALUES($1,$2,$3,'CONFIRMED')",
      [id, uploadId, randomUUID()],
    );
    return [id, randomUUID(), uploadId, key, sha, "application/pdf", 100];
  }
  async function audit(params) {
    await db.exec("SET LOCAL ROLE portal_runtime");
    try {
      await db.query(
        "SELECT portal_private.record_bound_cv_access($1,$2,$3,$4,$5,$6,$7)",
        params,
      );
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
  }
  async function denied(params, mutate = async () => {}) {
    await db.exec("SAVEPOINT denied_cv");
    try {
      await mutate();
      await assert.rejects(audit(params), { code: "42501" });
    } finally {
      await db.exec(
        "ROLLBACK TO SAVEPOINT denied_cv; RELEASE SAVEPOINT denied_cv",
      );
    }
    assert.equal(
      Number(
        (await db.query("SELECT count(*) n FROM portal.audit_logs")).rows[0].n,
      ),
      0,
    );
  }

  test("the exact signed descriptor is audited without granting table access to runtime", async () => {
    const params = await fixture();
    await audit(params);
    const log = (
      await db.query(
        "SELECT action,object_id,request_id,safe_changes FROM portal.audit_logs",
      )
    ).rows[0];
    assert.equal(log.action, "CV_URL_ISSUED");
    assert.equal(log.object_id, params[0]);
    assert.equal(log.request_id, params[1]);
    assert.deepEqual(log.safe_changes, { uploadId: params[2] });
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('portal_runtime','portal.uploads','SELECT') yes",
        )
      ).rows[0].yes,
      false,
    );
  });

  test("substituted object keys, hashes, types, sizes and bindings cannot be acknowledged", async () => {
    const params = await fixture();
    for (const [index, value] of [
      [0, randomUUID()],
      [2, randomUUID()],
      [3, "changed/key.pdf"],
      [4, randomBytes(32)],
      [5, "application/msword"],
      [6, 101],
    ]) {
      const changed = [...params];
      changed[index] = value;
      await denied(changed);
    }
  });

  test("fresh session, role, deletion and upload-revocation checks remain authoritative", async () => {
    const params = await fixture();
    for (const sql of [
      "SET LOCAL test.live='no'",
      "SET LOCAL test.role='READ_ONLY'",
      "SET LOCAL test.blocked='yes'",
    ])
      await denied(params, () => db.exec(sql));
    await denied(params, () =>
      db.query(
        "UPDATE portal.uploads SET access_revoked_at=now() WHERE id=$1",
        [params[2]],
      ),
    );
  });
});
