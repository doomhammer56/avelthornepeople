import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createStaffFixture, expectQueryError } from "./helpers.mjs";

test("Audit and outbox persistence", { timeout: 240_000 }, async (t) => {
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

  async function createAudit(
    objectId,
    actorId = staffId,
    requestId = randomUUID(),
  ) {
    const { rows } = await db.query(
      "INSERT INTO portal.audit_logs (actor_id, object_type, object_id, action, request_id) VALUES ($1, 'JOB', $2, 'UPDATED', $3) RETURNING *",
      [actorId, objectId, requestId],
    );
    return rows[0];
  }

  async function createEvent(
    aggregateId,
    deliveryKey = `DB01_EVT_${randomUUID()}`,
  ) {
    const { rows } = await db.query(
      "INSERT INTO portal.outbox_events (event_type, aggregate_id, delivery_key) VALUES ('JOB_UPDATED', $1, $2) RETURNING *",
      [aggregateId, deliveryKey],
    );
    return rows[0];
  }

  async function createJob() {
    const { rows } = await db.query(
      "INSERT INTO portal.jobs (canonical_slug, draft_content, owner_id) VALUES ($1, '{}'::jsonb, $2) RETURNING id",
      [`db01-events-${randomUUID()}`, staffId],
    );
    return rows[0].id;
  }

  async function createIntake() {
    const jobId = await createJob();
    const envelope = randomBytes(48);
    const candidate = await db.query(
      "INSERT INTO portal.candidates (name_encrypted, email_encrypted, phone_encrypted, email_hmac, phone_hmac, hmac_key_version) VALUES ($1, $1, $1, $2, $3, 1) RETURNING id",
      [envelope, randomBytes(32), randomBytes(32)],
    );
    const upload = await db.query(
      "INSERT INTO portal.uploads (storage_provider, bucket, object_key, declared_size_bytes, size_bytes, detected_type, sha256, scan_state, scanned_at, capability_hash, capability_expires_at) VALUES ('SUPABASE', 'db01-private-test', $1, 1024, 1024, 'application/pdf', $2, 'CLEAN', now(), $3, now() + interval '1 day') RETURNING id",
      [`db01-events/${randomUUID()}`, randomBytes(32), randomBytes(32)],
    );
    const application = await db.query(
      "INSERT INTO portal.applications (job_id, cv_upload_id, profile_encrypted, consent_at, policy_version, source, locale, idempotency_key, payload_digest, receipt_hash, receipt_expires_at) VALUES ($1, $2, $3, now(), 'v1', 'CAREERS', 'en', $4, $5, $6, now() + interval '1 day') RETURNING id",
      [
        jobId,
        upload.rows[0].id,
        envelope,
        randomUUID(),
        randomBytes(32),
        randomBytes(32),
      ],
    );
    return { id: application.rows[0].id, candidateId: candidate.rows[0].id };
  }

  await t.test(
    "records staff and system actors without imposing a single object table",
    async () => {
      const objectId = randomUUID();
      const entry = await createAudit(objectId);
      const system = await createAudit(objectId, null, entry.request_id);
      assert.equal(entry.actor_id, staffId);
      assert.equal(system.actor_id, null);
      assert.notEqual(entry.id, system.id);
      assert.deepEqual(entry.safe_changes, {});
      assert.ok(entry.created_at instanceof Date);
      for (const assignment of [
        "object_type = '  '",
        "action = '  '",
        "safe_changes = '[]'::jsonb",
        "safe_changes = 'null'::jsonb",
      ]) {
        await expectQueryError(
          db,
          `UPDATE portal.audit_logs SET ${assignment} WHERE id = $1`,
          [entry.id],
          "23514",
        );
      }
      await expectQueryError(
        db,
        "UPDATE portal.audit_logs SET actor_id = $2 WHERE id = $1",
        [entry.id, randomUUID()],
        "23503",
      );
      await expectQueryError(
        db,
        "UPDATE portal.audit_logs SET request_id = 'invalid' WHERE id = $1",
        [entry.id],
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

  await t.test(
    "creates pending events with unique delivery keys and object payloads",
    async () => {
      const aggregateId = randomUUID();
      const event = await createEvent(aggregateId);
      const second = await createEvent(aggregateId);
      assert.notEqual(event.id, second.id);
      assert.equal(event.state, "PENDING");
      assert.equal(event.attempts, 0);
      assert.equal(event.lease_token, null);
      assert.equal(event.lease_until, null);
      assert.deepEqual(event.safe_references, {});
      assert.ok(event.created_at instanceof Date);
      assert.equal(event.available_at.getTime(), event.created_at.getTime());
      for (const assignment of [
        "event_type = '  '",
        "delivery_key = '  '",
        "safe_references = '[]'::jsonb",
        "safe_references = 'null'::jsonb",
        "state = 'SENT'",
        "attempts = -1",
      ]) {
        await expectQueryError(
          db,
          `UPDATE portal.outbox_events SET ${assignment} WHERE id = $1`,
          [event.id],
          "23514",
        );
      }
      await expectQueryError(
        db,
        "UPDATE portal.outbox_events SET delivery_key = $2 WHERE id = $1",
        [second.id, event.delivery_key],
        "23505",
      );
    },
  );

  await t.test("requires complete leases only while processing", async () => {
    const event = await createEvent(randomUUID());
    const token = randomUUID();
    for (const assignment of [
      "state = 'PROCESSING'",
      "lease_token = $2",
      "lease_until = now() + interval '1 minute'",
      "state = 'PROCESSING', lease_token = $2",
      "state = 'PROCESSING', lease_until = now() + interval '1 minute'",
      "lease_token = $2, lease_until = now() + interval '1 minute'",
    ]) {
      await expectQueryError(
        db,
        `UPDATE portal.outbox_events SET ${assignment} WHERE id = $1`,
        assignment.includes("$2") ? [event.id, token] : [event.id],
        "23514",
      );
    }
    const processing = await db.query(
      "UPDATE portal.outbox_events SET state = 'PROCESSING', attempts = attempts + 1, lease_token = $2, lease_until = now() + interval '1 minute' WHERE id = $1 RETURNING state, attempts, lease_token",
      [event.id, token],
    );
    assert.deepEqual(processing.rows, [
      { state: "PROCESSING", attempts: 1, lease_token: token },
    ]);
    for (const assignment of [
      "lease_token = NULL",
      "lease_until = NULL",
      "state = 'PROCESSED'",
      "state = 'DEAD'",
    ]) {
      await expectQueryError(
        db,
        `UPDATE portal.outbox_events SET ${assignment} WHERE id = $1`,
        [event.id],
        "23514",
      );
    }
    await db.query(
      "UPDATE portal.outbox_events SET lease_until = now() - interval '1 minute' WHERE id = $1",
      [event.id],
    );
    const expired = await db.query(
      "SELECT lease_until < statement_timestamp() AS expired FROM portal.outbox_events WHERE id = $1",
      [event.id],
    );
    assert.deepEqual(expired.rows, [{ expired: true }]);
    for (const state of ["PENDING", "PROCESSED", "DEAD"]) {
      const result = await db.query(
        "UPDATE portal.outbox_events SET state = $2, lease_token = NULL, lease_until = NULL, available_at = now() + interval '1 hour' WHERE id = $1 RETURNING state, lease_token, lease_until",
        [event.id, state],
      );
      assert.deepEqual(result.rows, [
        { state, lease_token: null, lease_until: null },
      ]);
    }
  });

  await t.test(
    "writes a job revision with its audit and outbox records",
    async () => {
      const jobId = await createJob();
      let auditId, eventId;
      await db.query("SAVEPOINT job_change");
      try {
        await db.query(
          "UPDATE portal.jobs SET version = version + 1 WHERE id = $1",
          [jobId],
        );
        const audit = await db.query(
          "INSERT INTO portal.audit_logs (actor_id, object_type, object_id, action, safe_changes, request_id) VALUES ($1, 'JOB', $2, 'UPDATED', $3::jsonb, $4) RETURNING id",
          [staffId, jobId, JSON.stringify({ version: 2 }), randomUUID()],
        );
        const event = await db.query(
          "INSERT INTO portal.outbox_events (event_type, aggregate_id, delivery_key, safe_references) VALUES ('JOB_UPDATED', $1, $2, $3::jsonb) RETURNING id",
          [
            jobId,
            `DB01_EVT_job_${jobId}`,
            JSON.stringify({ jobId, version: 2 }),
          ],
        );
        auditId = audit.rows[0].id;
        eventId = event.rows[0].id;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT job_change");
        throw error;
      } finally {
        await db.query("RELEASE SAVEPOINT job_change");
      }
      const result = await db.query(
        "SELECT j.version, a.safe_changes, e.safe_references FROM portal.jobs j JOIN portal.audit_logs a ON a.object_id = j.id JOIN portal.outbox_events e ON e.aggregate_id = j.id WHERE j.id = $1 AND a.id = $2 AND e.id = $3",
        [jobId, auditId, eventId],
      );
      assert.deepEqual(result.rows, [
        {
          version: 2,
          safe_changes: { version: 2 },
          safe_references: { jobId, version: 2 },
        },
      ]);
    },
  );

  await t.test(
    "writes application confirmation with its audit and outbox records",
    async () => {
      const application = await createIntake();
      await db.query("SAVEPOINT application_confirmation");
      let auditId, eventId;
      try {
        await db.query(
          "UPDATE portal.applications SET intake_state = 'CONFIRMED', confirmed_at = now(), candidate_id = $2, cv_scan_state = 'CLEAN', version = version + 1 WHERE id = $1",
          [application.id, application.candidateId],
        );
        const audit = await db.query(
          "INSERT INTO portal.audit_logs (actor_id, object_type, object_id, action, safe_changes, request_id) VALUES ($1, 'APPLICATION', $2, 'CONFIRMED', '{\"intakeState\":\"CONFIRMED\",\"version\":2}'::jsonb, $3) RETURNING id",
          [staffId, application.id, randomUUID()],
        );
        const event = await db.query(
          "INSERT INTO portal.outbox_events (event_type, aggregate_id, delivery_key, safe_references) VALUES ('APPLICATION_CONFIRMED', $1, $2, $3::jsonb) RETURNING id",
          [
            application.id,
            `DB01_EVT_confirmed_${application.id}`,
            JSON.stringify({ applicationId: application.id, version: 2 }),
          ],
        );
        auditId = audit.rows[0].id;
        eventId = event.rows[0].id;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT application_confirmation");
        throw error;
      } finally {
        await db.query("RELEASE SAVEPOINT application_confirmation");
      }
      const result = await db.query(
        "SELECT p.intake_state, p.version, a.action, e.event_type, e.safe_references FROM portal.applications p JOIN portal.audit_logs a ON a.object_id = p.id JOIN portal.outbox_events e ON e.aggregate_id = p.id WHERE p.id = $1 AND a.id = $2 AND e.id = $3",
        [application.id, auditId, eventId],
      );
      assert.deepEqual(result.rows, [
        {
          intake_state: "CONFIRMED",
          version: 2,
          action: "CONFIRMED",
          event_type: "APPLICATION_CONFIRMED",
          safe_references: { applicationId: application.id, version: 2 },
        },
      ]);
    },
  );

  await t.test(
    "rolls back domain changes and audit inserts when event insertion fails",
    async () => {
      const application = await createIntake();
      for (const [table, id] of [
        ["jobs", await createJob()],
        ["applications", application.id],
      ]) {
        const existingEvent = await createEvent(id);
        const requestId = randomUUID();
        await db.query("SAVEPOINT failed_change");
        try {
          if (table === "applications") {
            await db.query(
              "UPDATE portal.applications SET intake_state = 'CONFIRMED', confirmed_at = now(), candidate_id = $2, cv_scan_state = 'CLEAN', version = version + 1 WHERE id = $1",
              [id, application.candidateId],
            );
          } else {
            await db.query(
              "UPDATE portal.jobs SET version = version + 1 WHERE id = $1",
              [id],
            );
          }
          await createAudit(id, staffId, requestId);
          await assert.rejects(createEvent(id, existingEvent.delivery_key), {
            code: "23505",
          });
        } finally {
          await db.query("ROLLBACK TO SAVEPOINT failed_change");
          await db.query("RELEASE SAVEPOINT failed_change");
        }
        const version = await db.query(
          `SELECT version FROM portal.${table} WHERE id = $1`,
          [id],
        );
        assert.deepEqual(version.rows, [{ version: 1 }]);
        const records = await db.query(
          "SELECT (SELECT count(*) FROM portal.audit_logs WHERE request_id = $1)::int AS audits, (SELECT count(*) FROM portal.outbox_events WHERE aggregate_id = $2)::int AS events",
          [requestId, id],
        );
        assert.deepEqual(records.rows, [{ audits: 0, events: 1 }]);
      }
      const state = await db.query(
        "SELECT intake_state, confirmed_at, candidate_id, cv_scan_state FROM portal.applications WHERE id = $1",
        [application.id],
      );
      assert.deepEqual(state.rows, [
        {
          intake_state: "RECEIVED",
          confirmed_at: null,
          candidate_id: null,
          cv_scan_state: null,
        },
      ]);
    },
  );

  await t.test(
    "uses UUID keys throughout the core and preserves partial queue indexes",
    async () => {
      const core = [
        "staff_profiles",
        "departments",
        "locations",
        "jobs",
        "job_locations",
        "candidates",
        "uploads",
        "applications",
        "audit_logs",
        "outbox_events",
      ];
      const primaryKeys = await db.query(
        "SELECT t.relname, a.atttypid = 'uuid'::regtype AS uuid FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid CROSS JOIN LATERAL unnest(c.conkey) AS k(attnum) JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum WHERE c.connamespace = 'portal'::regnamespace AND c.contype = 'p' AND t.relname = ANY($1::text[])",
        [core],
      );
      assert.equal(primaryKeys.rows.length, 11);
      assert.equal(
        new Set(primaryKeys.rows.map((row) => row.relname)).size,
        10,
      );
      assert.ok(primaryKeys.rows.every((row) => row.uuid));
      const foreignKeys = await db.query(
        "SELECT a.atttypid = b.atttypid AS same_type FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(source, target) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.source JOIN pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = k.target WHERE c.connamespace = 'portal'::regnamespace AND c.contype = 'f' AND t.relname = ANY($1::text[])",
        [core],
      );
      assert.ok(foreignKeys.rows.length >= 12);
      assert.ok(foreignKeys.rows.every((row) => row.same_type));
      const identifiers = await db.query(
        "SELECT udt_name FROM information_schema.columns WHERE table_schema = 'portal' AND ((table_name = 'audit_logs' AND column_name IN ('id', 'actor_id', 'object_id', 'request_id')) OR (table_name = 'outbox_events' AND column_name IN ('id', 'aggregate_id', 'lease_token')))",
      );
      assert.equal(identifiers.rows.length, 7);
      assert.ok(identifiers.rows.every((row) => row.udt_name === "uuid"));
      const indexes = await db.query(
        "SELECT c.relname, i.indisvalid, i.indisready, pg_get_expr(i.indpred, i.indrelid) AS predicate, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indrelid = 'portal.outbox_events'::regclass AND c.relname IN ('outbox_events_due_idx', 'outbox_events_lease_idx')",
      );
      assert.equal(indexes.rows.length, 2);
      for (const index of indexes.rows) {
        assert.equal(index.indisvalid, true);
        assert.equal(index.indisready, true);
        if (index.relname === "outbox_events_due_idx") {
          assert.match(index.predicate, /state = 'PENDING'/);
          assert.match(index.definition, /\(available_at\)/);
        } else {
          assert.match(index.predicate, /state = 'PROCESSING'/);
          assert.match(index.definition, /\(lease_until\)/);
        }
      }
    },
  );

  await t.test("denies ungranted access to audit and queue data", async () => {
    const tables = ["audit_logs", "outbox_events"];
    const flags = await db.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid IN ('portal.audit_logs'::regclass, 'portal.outbox_events'::regclass)",
    );
    assert.equal(flags.rows.length, 2);
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
        for (const table of tables) {
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
