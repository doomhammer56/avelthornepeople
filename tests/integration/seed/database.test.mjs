import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
import {
  businessTables,
  resetBusinessData,
  seedVacancies,
} from "../../../scripts/seed/database.mjs";
loadAuthTestEnvironment();

test(
  "Operator seed publishes valid EN/ZH jobs, preserves edits, and resets atomically without touching Admins",
  { timeout: 240000 },
  async (t) => {
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client({
          connectionString: process.env.DIRECT_URL,
          connectionTimeoutMillis: 15000,
          statement_timeout: 15000,
        }),
    );
    t.after(async () => {
      await db.query("ROLLBACK").catch(() => {});
      await db.end();
    });
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout='10s'");
    const admins = (
      await db.query(
        "SELECT id,display_name,role,active,version FROM portal.staff_profiles WHERE role='ADMIN' ORDER BY id",
      )
    ).rows;
    const actor = admins.find((a) => a.active);
    assert.ok(actor, "An active test Admin is required.");
    const result = await seedVacancies(db, actor.id);
    const ids = result.jobs.map((r) => r.id);
    assert.equal(ids.length, 10);
    await db.query(
      "UPDATE portal.jobs SET status='CLOSED',version=version+1 WHERE id=$1",
      [ids[0]],
    );
    const before = (await db.query("SELECT count(*) n FROM portal.audit_logs"))
      .rows[0].n;
    const repeated = await seedVacancies(db, actor.id);
    assert.ok(repeated.jobs.every((r) => r.action === "preserve"));
    assert.equal(
      (await db.query("SELECT status FROM portal.jobs WHERE id=$1", [ids[0]]))
        .rows[0].status,
      "CLOSED",
    );
    assert.equal(
      (await db.query("SELECT count(*) n FROM portal.audit_logs")).rows[0].n,
      before,
    );
    await db.query("SAVEPOINT file_guard");
    await db.query(
      "INSERT INTO portal.uploads(storage_provider,bucket,object_key,declared_size_bytes,capability_hash,capability_expires_at) VALUES('SUPABASE','cv-quarantine',$1,100,$2,now()+interval '1 hour')",
      [randomUUID(), randomBytes(32)],
    );
    await assert.rejects(
      resetBusinessData(db, []),
      /attached CV\/content files/,
    );
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM portal.jobs WHERE id=ANY($1::uuid[])",
            [ids],
          )
        ).rows[0].n,
      ),
      10,
    );
    await db.query("ROLLBACK TO SAVEPOINT file_guard");
    await resetBusinessData(db, []);
    for (const table of businessTables)
      assert.equal(
        Number(
          (await db.query(`SELECT count(*) n FROM portal.${table}`)).rows[0].n,
        ),
        0,
        table,
      );
    assert.deepEqual(
      (
        await db.query(
          "SELECT id,display_name,role,active,version FROM portal.staff_profiles ORDER BY id",
        )
      ).rows,
      admins,
    );
    const resetSeed = await seedVacancies(db, actor.id);
    assert.equal(
      resetSeed.jobs.filter((r) => r.action === "create-published").length,
      10,
    );
    // Validate fresh publications after reset; existing slugs may legitimately
    // have been closed or edited before this rollback-only suite runs.
    // Capability membership disappears with the outer rollback.
    const publishedIds = resetSeed.jobs.map((row) => row.id);
    await db.query(
      "GRANT portal_jobs_owner,portal_public_reader TO CURRENT_USER",
    );
    await db.query(
      "SELECT portal_private.validate_job_draft(draft_content,true,false) FROM portal.jobs WHERE id=ANY($1::uuid[])",
      [publishedIds],
    );
    await db.query("SET LOCAL ROLE portal_public_reader");
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM portal.visible_jobs WHERE id=ANY($1::uuid[])",
            [publishedIds],
          )
        ).rows[0].n,
      ),
      10,
    );
    await db.query("RESET ROLE");
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM portal.content_blocks WHERE published_content IS NOT NULL",
          )
        ).rows[0].n,
      ),
      6,
    );
  },
);
