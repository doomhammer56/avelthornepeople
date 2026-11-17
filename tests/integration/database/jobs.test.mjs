import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createStaffFixture, expectQueryError } from "./helpers.mjs";

test("Jobs and location assignments", { timeout: 240_000 }, async (t) => {
  assert.ok(process.env.DIRECT_URL, "DIRECT_URL is required.");
  const db = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 15_000,
  });
  await db.connect();
  t.after(async () => {
    try {
      await db.query("ROLLBACK");
    } finally {
      await db.end();
    }
  });
  await db.query("BEGIN");
  const staffId = await createStaffFixture(db);
  const department = await db.query(
    "INSERT INTO portal.departments (code, name_zh) VALUES ($1, '工程') RETURNING id",
    [`DB01_JOB_${randomUUID()}`],
  );
  const departmentId = department.rows[0].id;
  const locations = await db.query(
    "INSERT INTO portal.locations (code, name_zh, country_code, timezone) VALUES ($1, '基加利', 'RW', 'Africa/Kigali'), ($2, '伦敦', 'GB', 'Europe/London') RETURNING id",
    [`DB01_JOB_LOC_${randomUUID()}`, `DB01_JOB_LOC_${randomUUID()}`],
  );
  const [locationId, otherLocationId] = locations.rows.map((row) => row.id);
  const draftContent = { zh: { title: "工程师" } };
  const publishedContent = { zh: { title: "已批准的职位" } };

  async function createDraft() {
    const { rows } = await db.query(
      "INSERT INTO portal.jobs (canonical_slug, draft_content, owner_id) VALUES ($1, $2::jsonb, $3) RETURNING *",
      [`db01-job-${randomUUID()}`, JSON.stringify(draftContent), staffId],
    );
    return rows[0];
  }

  async function publish(jobId) {
    const { rows } = await db.query(
      "UPDATE portal.jobs SET status = 'PUBLISHED', published_content = $2::jsonb, published_version = 1, department_id = $3, job_type = 'FULL_TIME', experience = 'MID', approved_by = $4, approved_at = now(), publish_at = now(), close_at = now() + interval '1 day' WHERE id = $1 RETURNING *",
      [jobId, JSON.stringify(publishedContent), departmentId, staffId],
    );
    return rows[0];
  }

  await t.test("creates a private draft with safe defaults", async () => {
    const job = await createDraft();
    assert.match(job.id, /^[0-9a-f-]{36}$/);
    assert.equal(job.status, "DRAFT");
    assert.equal(job.version, 1);
    assert.equal(job.show_salary, false);
    assert.equal(job.owner_id, staffId.toLowerCase());
    assert.deepEqual(job.draft_content, draftContent);
    for (const field of [
      "published_content",
      "published_version",
      "approved_by",
      "approved_at",
      "publish_at",
      "close_at",
      "first_published_at",
      "department_id",
    ])
      assert.equal(job[field], null, field);
    assert.ok(job.created_at instanceof Date);
    assert.equal(job.updated_at.getTime(), job.created_at.getTime());
    await expectQueryError(
      db,
      "INSERT INTO portal.jobs (canonical_slug, draft_content, owner_id) VALUES ($1, '{}'::jsonb, $2)",
      [job.canonical_slug, staffId],
      "23505",
    );
  });

  await t.test(
    "rejects invalid lifecycle, content and version values",
    async () => {
      const job = await createDraft();
      for (const assignment of [
        "canonical_slug = '  '",
        "status = 'LIVE'",
        "version = 0",
        "draft_content = '[]'::jsonb",
        "draft_content = 'null'::jsonb",
        "job_type = '  '",
        "experience = '  '",
        "published_content = '{}'::jsonb",
        "approved_at = now()",
      ]) {
        await expectQueryError(
          db,
          `UPDATE portal.jobs SET ${assignment} WHERE id = $1`,
          [job.id],
          "23514",
        );
      }
      await expectQueryError(
        db,
        "UPDATE portal.jobs SET draft_content = NULL WHERE id = $1",
        [job.id],
        "23502",
      );
      await publish(job.id);
      for (const assignment of [
        "published_version = 0",
        "published_version = 2",
        "published_content = '[]'::jsonb",
        "published_content = 'null'::jsonb",
      ]) {
        await expectQueryError(
          db,
          `UPDATE portal.jobs SET ${assignment} WHERE id = $1`,
          [job.id],
          "23514",
        );
      }
    },
  );

  await t.test(
    "requires complete publication metadata and preserves the approved snapshot",
    async () => {
      const job = await createDraft();
      await expectQueryError(
        db,
        "UPDATE portal.jobs SET status = 'PUBLISHED' WHERE id = $1",
        [job.id],
        "23514",
      );
      const approved = await publish(job.id);
      assert.deepEqual(approved.published_content, publishedContent);
      for (const column of [
        "published_content",
        "published_version",
        "approved_by",
        "approved_at",
        "publish_at",
        "department_id",
        "job_type",
        "experience",
      ]) {
        await expectQueryError(
          db,
          `UPDATE portal.jobs SET ${column} = NULL WHERE id = $1`,
          [job.id],
          "23514",
        );
      }
      const edited = await db.query(
        "UPDATE portal.jobs SET draft_content = $2::jsonb, version = version + 1 WHERE id = $1 RETURNING status, draft_content, published_content, version, published_version",
        [job.id, JSON.stringify({ zh: { title: "待审核的修改" } })],
      );
      assert.deepEqual(edited.rows, [
        {
          status: "PUBLISHED",
          draft_content: { zh: { title: "待审核的修改" } },
          published_content: publishedContent,
          version: 2,
          published_version: 1,
        },
      ]);
      for (const status of ["PENDING_REVIEW", "PAUSED", "CLOSED"]) {
        const result = await db.query(
          "UPDATE portal.jobs SET status = $2 WHERE id = $1 RETURNING published_content",
          [job.id, status],
        );
        assert.deepEqual(result.rows[0].published_content, publishedContent);
      }
    },
  );

  await t.test("checks salary units, bounds and visibility", async () => {
    const job = await createDraft();
    await expectQueryError(
      db,
      "UPDATE portal.jobs SET show_salary = true WHERE id = $1",
      [job.id],
      "23514",
    );
    await expectQueryError(
      db,
      "UPDATE portal.jobs SET salary_min = 100 WHERE id = $1",
      [job.id],
      "23514",
    );
    const salary = await db.query(
      "UPDATE portal.jobs SET salary_min = 0, salary_max = 2500.50, salary_currency = 'USD', salary_period = 'MONTH', show_salary = true WHERE id = $1 RETURNING salary_min, salary_max",
      [job.id],
    );
    assert.deepEqual(salary.rows, [
      { salary_min: "0.00", salary_max: "2500.50" },
    ]);
    for (const assignment of [
      "salary_min = -1",
      "salary_max = -1",
      "salary_min = 3000",
      "salary_min = 'NaN'::numeric",
      "salary_max = 'NaN'::numeric",
      "salary_currency = 'usd'",
      "salary_currency = NULL",
      "salary_period = 'WEEK'",
      "salary_period = NULL",
      "salary_max = NULL",
    ]) {
      await expectQueryError(
        db,
        `UPDATE portal.jobs SET ${assignment} WHERE id = $1`,
        [job.id],
        "23514",
      );
    }
    const hidden = await db.query(
      "UPDATE portal.jobs SET show_salary = false WHERE id = $1 RETURNING show_salary, salary_max",
      [job.id],
    );
    assert.deepEqual(hidden.rows, [
      { show_salary: false, salary_max: "2500.50" },
    ]);
  });

  await t.test(
    "checks schedule order and maintains timestamps on SQL updates",
    async () => {
      const job = await createDraft();
      for (const offset of ["0 seconds", "-1 second"]) {
        await expectQueryError(
          db,
          "UPDATE portal.jobs SET publish_at = now(), close_at = now() + $2::interval WHERE id = $1",
          [job.id, offset],
          "23514",
        );
      }
      const result = await db.query(
        "UPDATE portal.jobs SET publish_at = now() + interval '1 day', close_at = now() + interval '2 days', updated_at = '2000-01-01'::timestamptz WHERE id = $1 RETURNING status, updated_at = transaction_timestamp() AS touched, close_at > publish_at AS ordered",
        [job.id],
      );
      assert.deepEqual(result.rows, [
        { status: "DRAFT", touched: true, ordered: true },
      ]);
    },
  );

  await t.test(
    "enforces foreign keys, join uniqueness and deletion behavior",
    async () => {
      const job = await createDraft();
      await publish(job.id);
      for (const column of ["owner_id", "approved_by", "department_id"]) {
        await expectQueryError(
          db,
          `UPDATE portal.jobs SET ${column} = $2 WHERE id = $1`,
          [job.id, randomUUID()],
          "23503",
        );
      }
      const insert =
        "INSERT INTO portal.job_locations (job_id, location_id) VALUES ($1, $2)";
      await db.query(insert, [job.id, locationId]);
      await db.query(insert, [job.id, otherLocationId]);
      await expectQueryError(db, insert, [job.id, locationId], "23505");
      await expectQueryError(db, insert, [randomUUID(), locationId], "23503");
      await expectQueryError(db, insert, [job.id, randomUUID()], "23503");
      for (const [table, id] of [
        ["staff_profiles", staffId],
        ["departments", departmentId],
        ["locations", locationId],
      ]) {
        await expectQueryError(
          db,
          `DELETE FROM portal.${table} WHERE id = $1`,
          [id],
          "23503",
        );
      }
      await db.query("DELETE FROM portal.jobs WHERE id = $1", [job.id]);
      const remaining = await db.query(
        "SELECT count(*)::int AS count FROM portal.job_locations WHERE job_id = $1",
        [job.id],
      );
      assert.deepEqual(remaining.rows, [{ count: 0 }]);
    },
  );

  await t.test("uses UUID references and indexes for job queries", async () => {
    const columns = await db.query(
      "SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema = 'portal' AND ((table_name = 'jobs' AND column_name IN ('id', 'owner_id', 'approved_by', 'department_id')) OR (table_name = 'job_locations' AND column_name IN ('job_id', 'location_id')))",
    );
    assert.equal(columns.rows.length, 6);
    assert.ok(columns.rows.every((column) => column.udt_name === "uuid"));
    const indexes = await db.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'portal' AND tablename IN ('jobs', 'job_locations')",
    );
    const names = new Set(indexes.rows.map((row) => row.indexname));
    for (const name of [
      "jobs_canonical_slug_key",
      "jobs_publish_idx",
      "jobs_close_idx",
      "jobs_filters_idx",
      "jobs_owner_idx",
      "jobs_approver_idx",
      "job_locations_location_idx",
    ]) {
      assert.ok(names.has(name), name);
    }
    const primaryKey = await db.query(
      "SELECT array_agg(a.attname::text ORDER BY k.ordinality) AS columns FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum WHERE c.conrelid = 'portal.job_locations'::regclass AND c.contype = 'p'",
    );
    assert.deepEqual(primaryKey.rows, [{ columns: ["job_id", "location_id"] }]);
  });

  await t.test("denies ungranted access to jobs and assignments", async () => {
    const flags = await db.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid IN ('portal.jobs'::regclass, 'portal.job_locations'::regclass)",
    );
    assert.equal(flags.rows.length, 2);
    assert.ok(flags.rows.every((row) => row.relrowsecurity));
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const table of ["jobs", "job_locations"]) {
        const privileges = await db.query(
          "SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed",
          [role, `portal.${table}`],
        );
        assert.deepEqual(privileges.rows, [{ allowed: false }]);
      }
      await db.query("SAVEPOINT role_access");
      try {
        await db.query(`SET LOCAL ROLE ${role}`);
        for (const table of ["jobs", "job_locations"]) {
          await expectQueryError(
            db,
            `SELECT * FROM portal.${table}`,
            [],
            "42501",
          );
        }
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT role_access");
        await db.query("RELEASE SAVEPOINT role_access");
      }
    }
  });
});
