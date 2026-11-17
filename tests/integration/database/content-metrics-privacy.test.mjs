import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createStaffFixture, expectQueryError } from "./helpers.mjs";

test(
  "Content, contact, metrics and deletion persistence",
  { timeout: 300_000 },
  async (t) => {
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
    const jobs = await db.query(
      "INSERT INTO portal.jobs (canonical_slug, draft_content, owner_id) VALUES ($1, '{}'::jsonb, $3), ($2, '{}'::jsonb, $3) RETURNING id",
      [
        `db01-features-${randomUUID()}`,
        `db01-features-${randomUUID()}`,
        staffId,
      ],
    );
    const [jobId, otherJobId] = jobs.rows.map((row) => row.id);
    const envelope = randomBytes(48);

    async function createContent() {
      const { rows } = await db.query(
        "INSERT INTO portal.content_blocks (type, draft_content) VALUES ('BANNER', $1::jsonb) RETURNING *",
        [JSON.stringify({ zh: { title: "测试内容" } })],
      );
      return rows[0];
    }

    async function createContact() {
      const { rows } = await db.query(
        "INSERT INTO portal.contact_messages (sender_encrypted, body_encrypted, locale) VALUES ($1, $1, 'zh') RETURNING *",
        [envelope],
      );
      return rows[0];
    }

    async function createMetric(
      targetJobId = null,
      pageKey = `DB01_PAGE_${randomUUID()}`,
    ) {
      const { rows } = await db.query(
        "INSERT INTO portal.daily_metrics (metric_date, job_id, page_key, locale, source) VALUES ('2026-10-16', $1, $2, 'zh', 'CAREERS') RETURNING *",
        [targetJobId, pageKey],
      );
      return rows[0];
    }

    async function createDeletion(candidateId = null) {
      const { rows } = await db.query(
        "INSERT INTO portal.deletion_requests (candidate_id, verified_requester_ref, reason_code, due_at) VALUES ($1, $2, 'ERASURE', now() + interval '30 days') RETURNING *",
        [candidateId, randomUUID()],
      );
      return rows[0];
    }

    await t.test(
      "keeps draft content separate from the published snapshot",
      async () => {
        const content = await createContent();
        assert.equal(content.sort_order, 0);
        assert.equal(content.version, 1);
        assert.equal(content.published_content, null);
        assert.equal(content.published_by, null);
        assert.equal(content.published_at, null);
        const published = {
          zh: { title: "已发布" },
          en: { title: "Published" },
        };
        await db.query(
          "UPDATE portal.content_blocks SET published_content = $2::jsonb, published_by = $3, published_at = now() WHERE id = $1",
          [content.id, JSON.stringify(published), staffId],
        );
        const result = await db.query(
          "UPDATE portal.content_blocks SET draft_content = $2::jsonb, version = version + 1 WHERE id = $1 RETURNING draft_content, published_content, version",
          [content.id, JSON.stringify({ zh: { title: "新草稿" } })],
        );
        assert.deepEqual(result.rows, [
          {
            draft_content: { zh: { title: "新草稿" } },
            published_content: published,
            version: 2,
          },
        ]);
        for (const column of [
          "published_content",
          "published_by",
          "published_at",
        ]) {
          await expectQueryError(
            db,
            `UPDATE portal.content_blocks SET ${column} = NULL WHERE id = $1`,
            [content.id],
            "23514",
          );
        }
      },
    );

    await t.test(
      "constrains content type, shape, version and publisher",
      async () => {
        const content = await createContent();
        for (const assignment of [
          "type = 'UNKNOWN'",
          "sort_order = -1",
          "version = 0",
          "draft_content = '[]'::jsonb",
          "draft_content = 'null'::jsonb",
          "published_content = '{}'::jsonb",
        ]) {
          await expectQueryError(
            db,
            `UPDATE portal.content_blocks SET ${assignment} WHERE id = $1`,
            [content.id],
            "23514",
          );
        }
        await expectQueryError(
          db,
          "UPDATE portal.content_blocks SET draft_content = NULL WHERE id = $1",
          [content.id],
          "23502",
        );
        await expectQueryError(
          db,
          "UPDATE portal.content_blocks SET published_content = '{}'::jsonb, published_at = now(), published_by = $2 WHERE id = $1",
          [content.id, randomUUID()],
          "23503",
        );
        await db.query(
          "UPDATE portal.content_blocks SET published_content = '{}'::jsonb, published_at = now(), published_by = $2 WHERE id = $1",
          [content.id, staffId],
        );
        await expectQueryError(
          db,
          "UPDATE portal.content_blocks SET published_content = '[]'::jsonb WHERE id = $1",
          [content.id],
          "23514",
        );
        for (const type of [
          "PROFILE",
          "CULTURE",
          "BENEFIT",
          "LOCATION",
          "TEAM",
        ]) {
          await db.query(
            "UPDATE portal.content_blocks SET type = $2 WHERE id = $1",
            [content.id, type],
          );
        }
      },
    );

    await t.test(
      "stores private contact data with safe inbox defaults",
      async () => {
        const contact = await createContact();
        assert.equal(contact.state, "NEW");
        assert.equal(contact.assigned_to, null);
        assert.deepEqual(contact.sender_encrypted, envelope);
        assert.deepEqual(contact.body_encrypted, envelope);
        for (const assignment of [
          "sender_encrypted = ''::bytea",
          "body_encrypted = ''::bytea",
          "locale = 'fr'",
          "state = 'DONE'",
        ]) {
          await expectQueryError(
            db,
            `UPDATE portal.contact_messages SET ${assignment} WHERE id = $1`,
            [contact.id],
            "23514",
          );
        }
        await expectQueryError(
          db,
          "UPDATE portal.contact_messages SET body_encrypted = NULL WHERE id = $1",
          [contact.id],
          "23502",
        );
        await expectQueryError(
          db,
          "UPDATE portal.contact_messages SET assigned_to = $2 WHERE id = $1",
          [contact.id, randomUUID()],
          "23503",
        );
        for (const state of ["IN_PROGRESS", "RESOLVED", "SPAM"]) {
          await db.query(
            "UPDATE portal.contact_messages SET assigned_to = $2, state = $3, locale = 'en' WHERE id = $1",
            [contact.id, staffId, state],
          );
        }
      },
    );

    await t.test(
      "keeps metrics unique for site-wide and job-specific dimensions",
      async () => {
        const site = await createMetric();
        assert.equal(site.page_views, "0");
        assert.equal(site.job_id, null);
        const duplicate =
          "INSERT INTO portal.daily_metrics (metric_date, job_id, page_key, locale, source) VALUES ('2026-10-16', $1, $2, 'zh', 'CAREERS')";
        await expectQueryError(db, duplicate, [null, site.page_key], "23505");
        const job = await createMetric(jobId, site.page_key);
        await expectQueryError(db, duplicate, [jobId, site.page_key], "23505");
        const otherJob = await createMetric(otherJobId, site.page_key);
        assert.notEqual(job.id, otherJob.id);
        const upsert = await db.query(
          "INSERT INTO portal.daily_metrics (metric_date, job_id, page_key, locale, source, page_views) VALUES ('2026-10-16', NULL, $1, 'zh', 'CAREERS', 2) ON CONFLICT (metric_date, job_id, page_key, locale, source) DO UPDATE SET page_views = portal.daily_metrics.page_views + EXCLUDED.page_views RETURNING id, page_views",
          [site.page_key],
        );
        assert.deepEqual(upsert.rows, [{ id: site.id, page_views: "2" }]);
        await db.query(
          "INSERT INTO portal.daily_metrics (metric_date, page_key, locale, source) VALUES ('2026-10-16', $1, 'en', 'CAREERS'), ('2026-10-16', $1, 'zh', 'DIRECT'), ('2026-10-17', $1, 'zh', 'CAREERS')",
          [site.page_key],
        );
        const index = await db.query(
          "SELECT indnullsnotdistinct FROM pg_index WHERE indexrelid = 'portal.daily_metrics_dimensions_key'::regclass",
        );
        assert.deepEqual(index.rows, [{ indnullsnotdistinct: true }]);
      },
    );

    await t.test(
      "checks metric counters, dimensions and job retention",
      async () => {
        const metric = await createMetric(jobId);
        for (const assignment of [
          "page_views = -1",
          "page_key = '  '",
          "source = '  '",
          "locale = 'fr'",
        ]) {
          await expectQueryError(
            db,
            `UPDATE portal.daily_metrics SET ${assignment} WHERE id = $1`,
            [metric.id],
            "23514",
          );
        }
        await expectQueryError(
          db,
          "UPDATE portal.daily_metrics SET job_id = $2 WHERE id = $1",
          [metric.id, randomUUID()],
          "23503",
        );
        await expectQueryError(
          db,
          "DELETE FROM portal.jobs WHERE id = $1",
          [jobId],
          "23503",
        );
      },
    );

    await t.test(
      "requires verification and consistent dates for deletion completion",
      async () => {
        const request = await createDeletion();
        assert.equal(request.state, "REQUESTED");
        assert.equal(request.verified_at, null);
        assert.equal(request.verified_by, null);
        assert.equal(request.completed_at, null);
        assert.deepEqual(request.cleanup_progress, {});
        for (const assignment of [
          "state = 'DONE'",
          "reason_code = '  '",
          "cleanup_progress = '[]'::jsonb",
          "cleanup_progress = 'null'::jsonb",
          "due_at = requested_at - interval '1 day'",
          "verified_at = requested_at - interval '1 second'",
          "state = 'VERIFIED'",
          "completed_at = now()",
        ]) {
          await expectQueryError(
            db,
            `UPDATE portal.deletion_requests SET ${assignment} WHERE id = $1`,
            [request.id],
            "23514",
          );
        }
        await expectQueryError(
          db,
          "UPDATE portal.deletion_requests SET verified_by = $2 WHERE id = $1",
          [request.id, randomUUID()],
          "23503",
        );
        await db.query(
          "UPDATE portal.deletion_requests SET state = 'VERIFIED', verified_at = now(), verified_by = $2 WHERE id = $1",
          [request.id, staffId],
        );
        for (const assignment of [
          "verified_by = NULL",
          "verified_at = NULL",
          "state = 'COMPLETED'",
          "state = 'COMPLETED', completed_at = verified_at - interval '1 second'",
        ]) {
          await expectQueryError(
            db,
            `UPDATE portal.deletion_requests SET ${assignment} WHERE id = $1`,
            [request.id],
            "23514",
          );
        }
        await db.query(
          "UPDATE portal.deletion_requests SET state = 'ON_HOLD' WHERE id = $1",
          [request.id],
        );
        await db.query(
          "UPDATE portal.deletion_requests SET state = 'PROCESSING' WHERE id = $1",
          [request.id],
        );
        const completed = await db.query(
          "UPDATE portal.deletion_requests SET state = 'COMPLETED', completed_at = now() WHERE id = $1 RETURNING state, completed_at >= verified_at AS ordered",
          [request.id],
        );
        assert.deepEqual(completed.rows, [
          { state: "COMPLETED", ordered: true },
        ]);
        await expectQueryError(
          db,
          "UPDATE portal.deletion_requests SET state = 'REJECTED' WHERE id = $1",
          [request.id],
          "23514",
        );
      },
    );

    await t.test(
      "preserves deletion receipts after candidate removal",
      async () => {
        const candidate = await db.query(
          "INSERT INTO portal.candidates (name_encrypted, email_encrypted, phone_encrypted, email_hmac, phone_hmac, hmac_key_version) VALUES ($1, $1, $1, $2, $3, 1) RETURNING id",
          [envelope, randomBytes(32), randomBytes(32)],
        );
        const request = await createDeletion(candidate.rows[0].id);
        await db.query(
          "UPDATE portal.deletion_requests SET state = 'PROCESSING', verified_at = now(), verified_by = $2 WHERE id = $1",
          [request.id, staffId],
        );
        await db.query("DELETE FROM portal.candidates WHERE id = $1", [
          candidate.rows[0].id,
        ]);
        const retained = await db.query(
          "SELECT id, candidate_id, verified_requester_ref, verified_by, state FROM portal.deletion_requests WHERE id = $1",
          [request.id],
        );
        assert.deepEqual(retained.rows, [
          {
            id: request.id,
            candidate_id: null,
            verified_requester_ref: request.verified_requester_ref,
            verified_by: staffId,
            state: "PROCESSING",
          },
        ]);
        await expectQueryError(
          db,
          "UPDATE portal.deletion_requests SET candidate_id = $2 WHERE id = $1",
          [request.id, randomUUID()],
          "23503",
        );
        await expectQueryError(
          db,
          "UPDATE portal.deletion_requests SET verified_requester_ref = 'invalid' WHERE id = $1",
          [request.id],
          "22P02",
        );
        await expectQueryError(
          db,
          "DELETE FROM portal.staff_profiles WHERE id = $1",
          [staffId],
          "23503",
        );
      },
    );

    await t.test("maintains update timestamps through direct SQL", async () => {
      const content = await createContent();
      const contact = await createContact();
      const metric = await createMetric();
      const request = await createDeletion();
      for (const [table, id] of [
        ["content_blocks", content.id],
        ["contact_messages", contact.id],
        ["daily_metrics", metric.id],
        ["deletion_requests", request.id],
      ]) {
        const result = await db.query(
          `UPDATE portal.${table} SET updated_at = '2000-01-01'::timestamptz WHERE id = $1 RETURNING updated_at = transaction_timestamp() AS touched`,
          [id],
        );
        assert.deepEqual(result.rows, [{ touched: true }]);
      }
    });

    await t.test(
      "all fifteen application tables use UUID keys and matching references",
      async () => {
        const primaryKeys = await db.query(
          "SELECT t.relname, a.atttypid = 'uuid'::regtype AS uuid FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid CROSS JOIN LATERAL unnest(c.conkey) AS k(attnum) JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum WHERE c.connamespace = 'portal'::regnamespace AND c.contype = 'p'",
        );
        assert.equal(primaryKeys.rows.length, 16);
        assert.equal(
          new Set(primaryKeys.rows.map((row) => row.relname)).size,
          15,
        );
        assert.ok(primaryKeys.rows.every((row) => row.uuid));
        const references = await db.query(
          "SELECT a.atttypid = b.atttypid AS same_type FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(source, target) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.source JOIN pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = k.target WHERE c.connamespace = 'portal'::regnamespace AND c.contype = 'f'",
        );
        assert.ok(references.rows.length >= 17);
        assert.ok(references.rows.every((row) => row.same_type));
        const identifiers = await db.query(
          "SELECT udt_name FROM information_schema.columns WHERE table_schema = 'portal' AND table_name = 'deletion_requests' AND column_name = 'verified_requester_ref'",
        );
        assert.deepEqual(identifiers.rows, [{ udt_name: "uuid" }]);
        const indexes = await db.query(
          "SELECT indexname FROM pg_indexes WHERE schemaname = 'portal' AND tablename IN ('content_blocks', 'contact_messages', 'daily_metrics', 'deletion_requests')",
        );
        const names = new Set(indexes.rows.map((row) => row.indexname));
        for (const name of [
          "content_blocks_order_idx",
          "content_blocks_publisher_idx",
          "contact_messages_inbox_idx",
          "contact_messages_assignee_idx",
          "daily_metrics_job_idx",
          "deletion_requests_queue_idx",
          "deletion_requests_candidate_idx",
          "deletion_requests_verifier_idx",
        ])
          assert.ok(names.has(name), name);
      },
    );

    await t.test("denies ungranted access to the four new tables", async () => {
      const tables = [
        "content_blocks",
        "contact_messages",
        "daily_metrics",
        "deletion_requests",
      ];
      const flags = await db.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid IN ('portal.content_blocks'::regclass, 'portal.contact_messages'::regclass, 'portal.daily_metrics'::regclass, 'portal.deletion_requests'::regclass)",
      );
      assert.equal(flags.rows.length, 4);
      assert.ok(flags.rows.every((row) => row.relrowsecurity));
      for (const role of ["anon", "authenticated", "service_role"]) {
        for (const table of tables) {
          const privileges = await db.query(
            "SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed",
            [role, `portal.${table}`],
          );
          assert.deepEqual(privileges.rows, [{ allowed: false }]);
        }
        await db.query("SAVEPOINT role_access");
        try {
          await db.query(`SET LOCAL ROLE ${role}`);
          for (const table of tables)
            await expectQueryError(
              db,
              `SELECT * FROM portal.${table}`,
              [],
              "42501",
            );
        } finally {
          await db.query("ROLLBACK TO SAVEPOINT role_access");
          await db.query("RELEASE SAVEPOINT role_access");
        }
      }
    });
  },
);
