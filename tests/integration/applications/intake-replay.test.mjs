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

const baseline = readFileSync(
  "prisma/migrations/20261026000400_public_application_intake/migration.sql",
  "utf8",
).match(
  /CREATE FUNCTION portal_private\.application_upload\([\s\S]*?END \$\$;/,
)[0];

describe("Committed application replay (isolated PostgreSQL)", () => {
  let db;
  before(async () => {
    db = new PGlite();
    await db.exec(`CREATE SCHEMA portal; CREATE SCHEMA portal_private;
      CREATE ROLE portal_recruitment_owner NOLOGIN NOBYPASSRLS;
      CREATE ROLE portal_runtime NOLOGIN NOBYPASSRLS;
      CREATE TABLE portal.uploads (
        id uuid PRIMARY KEY,intake_job_id uuid,intake_request_id uuid,
        object_key text,declared_size_bytes bigint,sha256 bytea,
        capability_hash bytea,capability_expires_at timestamptz,access_revoked_at timestamptz
      );
      CREATE TABLE portal.applications (
        id uuid PRIMARY KEY,job_id uuid,idempotency_key uuid,cv_upload_id uuid UNIQUE,
        intake_state text,payload_digest bytea
      );
      ALTER TABLE portal.uploads ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal.applications ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA portal,portal_private TO portal_recruitment_owner;
      GRANT USAGE ON SCHEMA portal_private TO portal_runtime;
      GRANT SELECT ON portal.uploads,portal.applications TO portal_recruitment_owner;
      CREATE POLICY replay_upload_owner ON portal.uploads TO portal_recruitment_owner USING(true);
      CREATE POLICY replay_application_owner ON portal.applications TO portal_recruitment_owner USING(true);
      ${baseline}
      ALTER FUNCTION portal_private.application_upload(uuid,bytea) OWNER TO portal_recruitment_owner;
      REVOKE ALL ON FUNCTION portal_private.application_upload(uuid,bytea) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION portal_private.application_upload(uuid,bytea) TO portal_runtime;
    `);
    await db.exec(
      readFileSync(
        "prisma/migrations/20261027000300_application_replay/migration.sql",
        "utf8",
      ),
    );
  });
  after(async () => db?.close());
  beforeEach(async () => db.exec("BEGIN"));
  afterEach(async () => db.exec("ROLLBACK"));

  async function fixture(confirmed = true) {
    const uploadId = randomUUID(),
      jobId = randomUUID(),
      requestId = randomUUID();
    const cap = randomBytes(32),
      sha = randomBytes(32),
      digest = randomBytes(32);
    await db.query(
      `INSERT INTO portal.uploads VALUES($1,$2,$3,$4,100,$5,$6,now()+interval '15 minutes',NULL)`,
      [uploadId, jobId, requestId, `${uploadId}/${randomUUID()}.pdf`, sha, cap],
    );
    if (confirmed)
      await db.query(
        "INSERT INTO portal.applications VALUES($1,$2,$3,$4,'CONFIRMED',$5)",
        [randomUUID(), jobId, requestId, uploadId, digest],
      );
    return { uploadId, jobId, requestId, cap, sha, digest };
  }
  async function readUpload(f) {
    await db.exec("SET LOCAL ROLE portal_runtime");
    try {
      return (
        await db.query(
          "SELECT portal_private.application_upload($1,$2) upload",
          [f.uploadId, f.cap],
        )
      ).rows[0].upload;
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
  }
  async function replay(f) {
    await db.exec("SET LOCAL ROLE portal_runtime");
    try {
      await db.query(
        "SELECT portal_private.replay_application($1,$2,$3,$4,$5)",
        [f.uploadId, f.cap, f.jobId, f.requestId, f.digest],
      );
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
  }
  async function rejected(f, code) {
    await db.exec("SAVEPOINT rejected_replay");
    try {
      await assert.rejects(replay(f), { code });
    } finally {
      await db.exec(
        "ROLLBACK TO SAVEPOINT rejected_replay; RELEASE SAVEPOINT rejected_replay",
      );
    }
  }

  test("only confirmed uploads expose a verified hash for storage-free retries", async () => {
    const saved = await fixture();
    const fresh = await fixture(false);
    assert.equal(
      (await readUpload(saved)).acceptedSha256,
      saved.sha.toString("hex"),
    );
    assert.equal((await readUpload(fresh)).acceptedSha256, null);
    await replay(saved);
    assert.equal(
      Number(
        (await db.query("SELECT count(*) n FROM portal.applications")).rows[0]
          .n,
      ),
      1,
    );
  });

  test("committed replay survives upload capability expiry and remains read-only", async () => {
    const saved = await fixture();
    await db.query(
      "UPDATE portal.uploads SET capability_expires_at=now()-interval '1 day' WHERE id=$1",
      [saved.uploadId],
    );
    assert.equal(
      (await readUpload(saved)).acceptedSha256,
      saved.sha.toString("hex"),
    );
    await replay(saved);
    await replay(saved);
    assert.equal(
      Number(
        (await db.query("SELECT count(*) n FROM portal.applications")).rows[0]
          .n,
      ),
      1,
    );
  });

  test("changed payloads conflict and capabilities cannot cross job, request or upload bindings", async () => {
    const saved = await fixture();
    await rejected({ ...saved, digest: randomBytes(32) }, "40001");
    for (const change of [
      { cap: randomBytes(32) },
      { jobId: randomUUID() },
      { requestId: randomUUID() },
      { uploadId: randomUUID() },
    ])
      await rejected({ ...saved, ...change }, "22023");
    await rejected(await fixture(false), "22023");
  });

  test("revocation prevents both reading the descriptor and acknowledging replay", async () => {
    const saved = await fixture();
    await db.query(
      "UPDATE portal.uploads SET access_revoked_at=now() WHERE id=$1",
      [saved.uploadId],
    );
    await rejected(saved, "22023");
    await assert.rejects(readUpload(saved), { code: "22023" });
  });

  test("replay does not grant direct data access or mutation rights to runtime", async () => {
    const {
      rows: [rights],
    } = await db.query(`SELECT
      pg_get_userbyid(proowner) owner,prosecdef,proconfig,
      has_function_privilege('portal_runtime','portal_private.replay_application(uuid,bytea,uuid,uuid,bytea)','EXECUTE') callable,
      has_table_privilege('portal_runtime','portal.applications','SELECT') readable,
      has_table_privilege('portal_recruitment_owner','portal.applications','UPDATE') writable
      FROM pg_proc WHERE oid='portal_private.replay_application(uuid,bytea,uuid,uuid,bytea)'::regprocedure`);
    assert.equal(rights.owner, "portal_recruitment_owner");
    assert.equal(rights.prosecdef, true);
    assert.ok(rights.proconfig.includes('search_path=""'));
    assert.equal(rights.callable, true);
    assert.equal(rights.readable, false);
    assert.equal(rights.writable, false);
  });
});
