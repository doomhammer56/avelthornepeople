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

describe("Leased upload cleanup (isolated PostgreSQL)", () => {
  let db;
  before(async () => {
    db = new PGlite();
    await db.exec(`CREATE SCHEMA portal; CREATE SCHEMA portal_private;
      CREATE ROLE portal_recruitment_owner NOLOGIN NOBYPASSRLS;
      CREATE ROLE portal_runtime NOLOGIN NOBYPASSRLS;
      CREATE TABLE portal.uploads (
        id uuid PRIMARY KEY,intake_job_id uuid,object_key text,scan_state text,
        storage_provider text,bucket text,provider_upload_expires_at timestamptz
      );
      CREATE TABLE portal.applications (cv_upload_id uuid REFERENCES portal.uploads(id));
      ALTER TABLE portal.uploads ENABLE ROW LEVEL SECURITY;
      ALTER TABLE portal.applications ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA portal,portal_private TO portal_recruitment_owner;
      GRANT USAGE ON SCHEMA portal_private TO portal_runtime;
      GRANT SELECT,UPDATE,DELETE ON portal.uploads TO portal_recruitment_owner;
      GRANT SELECT ON portal.applications TO portal_recruitment_owner;
      CREATE POLICY cleanup_upload_owner ON portal.uploads TO portal_recruitment_owner USING(true) WITH CHECK(true);
      CREATE POLICY cleanup_application_owner ON portal.applications TO portal_recruitment_owner USING(true);
    `);
    for (const name of [
      "20261027000400_upload_cleanup_claims",
      "20261027000500_upload_cleanup_index",
    ])
      await db.exec(
        readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"),
      );
  });
  after(async () => db?.close());
  beforeEach(async () => db.exec("BEGIN"));
  afterEach(async () => db.exec("ROLLBACK"));

  async function upload(
    age = "10 minutes",
    state = "PENDING",
    bucket = "cv-quarantine",
  ) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO portal.uploads VALUES($1,$2,$3,$4,'SUPABASE',$5,now()-$6::interval)",
      [id, randomUUID(), `${id}/${randomUUID()}.pdf`, state, bucket, age],
    );
    return id;
  }
  async function asRuntime(sql, params = []) {
    await db.exec("SET LOCAL ROLE portal_runtime");
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
    }
  }
  async function claim() {
    return (
      await asRuntime(
        "SELECT portal_private.claim_application_upload_cleanup() uploads",
      )
    ).rows[0].uploads;
  }
  async function finish(claims, status = "removed") {
    return (
      await asRuntime(
        "SELECT portal_private.finish_application_upload_cleanup($1) result",
        [
          JSON.stringify(
            claims.map((row) => ({
              id: row.id,
              leaseToken: row.leaseToken,
              status,
            })),
          ),
        ],
      )
    ).rows[0].result;
  }
  async function present(id) {
    return (
      await db.query(
        "SELECT EXISTS(SELECT 1 FROM portal.uploads WHERE id=$1) yes",
        [id],
      )
    ).rows[0].yes;
  }

  test("only expired, unattached quarantine files are claimed and live leases cannot be claimed twice", async () => {
    const eligible = await upload();
    await upload("1 minute");
    await upload("10 minutes", "CLEAN");
    await upload("10 minutes", "PENDING", "cv-clean");
    const attached = await upload();
    await db.query("INSERT INTO portal.applications VALUES($1)", [attached]);
    const claims = await claim();
    assert.deepEqual(
      claims.map((row) => row.id),
      [eligible],
    );
    assert.deepEqual(await claim(), []);
  });

  test("successful batch completion removes uploads and claim state atomically", async () => {
    const ids = [];
    for (let i = 0; i < 20; i++) ids.push(await upload());
    const claims = await claim();
    assert.equal(claims.length, 20);
    assert.deepEqual(await finish(claims), {
      removed: 20,
      failed: 0,
      skipped: 0,
    });
    assert.equal(
      Number(
        (await db.query("SELECT count(*) n FROM portal.uploads")).rows[0].n,
      ),
      0,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM portal_private.upload_cleanup_claims",
          )
        ).rows[0].n,
      ),
      0,
    );
    assert.deepEqual(await finish(claims), {
      removed: 0,
      failed: 0,
      skipped: 20,
    });
  });

  test("failed oldest files back off while newer files continue to progress", async () => {
    const older = await upload("1 day");
    const first = await claim();
    assert.deepEqual(await finish(first, "failed"), {
      removed: 0,
      failed: 1,
      skipped: 0,
    });
    const newer = await upload();
    assert.deepEqual(
      (await claim()).map((row) => row.id),
      [newer],
    );
    assert.equal(await present(older), true);
    const wait = (
      await db.query(
        "SELECT extract(epoch FROM available_at-now()) seconds FROM portal_private.upload_cleanup_claims WHERE upload_id=$1",
        [older],
      )
    ).rows[0];
    assert.ok(Number(wait.seconds) >= 29);
  });

  test("expired leases can be reclaimed and old tokens cannot finalize the new claim", async () => {
    const id = await upload();
    const first = await claim();
    await db.query(
      "UPDATE portal_private.upload_cleanup_claims SET lease_until=now()-interval '1 second' WHERE upload_id=$1",
      [id],
    );
    const second = await claim();
    assert.notEqual(second[0].leaseToken, first[0].leaseToken);
    assert.deepEqual(await finish(first), {
      removed: 0,
      failed: 0,
      skipped: 1,
    });
    assert.equal(await present(id), true);
    assert.deepEqual(await finish(second), {
      removed: 1,
      failed: 0,
      skipped: 0,
    });
  });

  test("finalization rechecks attachments and expiry before deleting database rows", async () => {
    const id = await upload();
    const claims = await claim();
    await db.query("INSERT INTO portal.applications VALUES($1)", [id]);
    assert.deepEqual(await finish(claims), {
      removed: 0,
      failed: 0,
      skipped: 1,
    });
    assert.equal(await present(id), true);
    await db.query("DELETE FROM portal.applications");
    await db.query(
      "UPDATE portal_private.upload_cleanup_claims SET available_at=now()-interval '1 second' WHERE upload_id=$1",
      [id],
    );
    const next = await claim();
    await db.query(
      "UPDATE portal.uploads SET provider_upload_expires_at=now()+interval '1 hour' WHERE id=$1",
      [id],
    );
    assert.deepEqual(await finish(next), { removed: 0, failed: 0, skipped: 1 });
    assert.equal(await present(id), true);
  });

  test("repeated provider failures cap backoff and a wrong token never deletes a row", async () => {
    const id = await upload();
    const claims = await claim();
    assert.deepEqual(
      await finish([{ ...claims[0], leaseToken: randomUUID() }]),
      { removed: 0, failed: 0, skipped: 1 },
    );
    await db.query(
      "UPDATE portal_private.upload_cleanup_claims SET attempts=16 WHERE upload_id=$1",
      [id],
    );
    await finish(claims, "failed");
    const wait = (
      await db.query(
        "SELECT extract(epoch FROM available_at-statement_timestamp()) seconds FROM portal_private.upload_cleanup_claims WHERE upload_id=$1",
        [id],
      )
    ).rows[0];
    assert.ok(Number(wait.seconds) > 3590 && Number(wait.seconds) <= 3600);
    assert.equal(await present(id), true);
  });

  test("runtime has only function access and cannot edit cleanup leases directly", async () => {
    const {
      rows: [rights],
    } = await db.query(`SELECT
      has_function_privilege('portal_runtime','portal_private.claim_application_upload_cleanup()','EXECUTE') callable,
      has_table_privilege('portal_runtime','portal_private.upload_cleanup_claims','UPDATE') writable,
      has_table_privilege('portal_runtime','portal.uploads','DELETE') deletable`);
    assert.equal(rights.callable, true);
    assert.equal(rights.writable, false);
    assert.equal(rights.deletable, false);
  });
});
