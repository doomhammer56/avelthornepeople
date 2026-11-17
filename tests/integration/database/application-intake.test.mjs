import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createStaffFixture, expectQueryError } from "./helpers.mjs";

test(
  "Candidate and application intake persistence",
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
      [`db01-intake-${randomUUID()}`, `db01-intake-${randomUUID()}`, staffId],
    );
    const [jobId, otherJobId] = jobs.rows.map((row) => row.id);
    const envelope = randomBytes(48);

    async function createCandidate(
      emailHmac = randomBytes(32),
      phoneHmac = randomBytes(32),
    ) {
      const { rows } = await db.query(
        "INSERT INTO portal.candidates (name_encrypted, email_encrypted, phone_encrypted, email_hmac, phone_hmac, hmac_key_version) VALUES ($1, $1, $1, $2, $3, 1) RETURNING *",
        [envelope, emailHmac, phoneHmac],
      );
      return rows[0];
    }

    async function createUpload(size = 1024) {
      const { rows } = await db.query(
        "INSERT INTO portal.uploads (storage_provider, bucket, object_key, declared_size_bytes, capability_hash, capability_expires_at) VALUES ('SUPABASE', 'db01-private-test', $1, $2, $3, now() + interval '1 day') RETURNING *",
        [`db01-intake/${randomUUID()}`, size, randomBytes(32)],
      );
      return rows[0];
    }

    async function markClean(uploadId, type = "application/pdf") {
      await db.query(
        "UPDATE portal.uploads SET scan_state = 'CLEAN', size_bytes = declared_size_bytes, sha256 = $2, detected_type = $3, scanned_at = now() WHERE id = $1",
        [uploadId, randomBytes(32), type],
      );
    }

    async function createApplication(targetJobId = jobId, uploadId) {
      uploadId ??= (await createUpload()).id;
      const { rows } = await db.query(
        "INSERT INTO portal.applications (job_id, cv_upload_id, profile_encrypted, consent_at, policy_version, source, locale, idempotency_key, payload_digest, receipt_hash, receipt_expires_at) VALUES ($1, $2, $3, now(), 'v1', 'CAREERS', 'zh', $4, $5, $6, now() + interval '1 day') RETURNING *",
        [
          targetJobId,
          uploadId,
          envelope,
          randomUUID(),
          randomBytes(32),
          randomBytes(32),
        ],
      );
      return rows[0];
    }

    await t.test(
      "allows shared candidate contacts and validates binary storage",
      async () => {
        const email = randomBytes(32);
        const phone = randomBytes(32);
        const first = await createCandidate(email, phone);
        const second = await createCandidate(email, phone);
        assert.notEqual(first.id, second.id);
        assert.deepEqual(first.email_hmac, email);
        assert.deepEqual(second.phone_hmac, phone);
        assert.deepEqual(first.name_encrypted, envelope);
        assert.equal(first.deletion_requested_at, null);
        await db.query(
          "UPDATE portal.candidates SET hmac_key_version = 2 WHERE id = $1",
          [second.id],
        );
        for (const [column, value] of [
          ["name_encrypted", Buffer.alloc(0)],
          ["email_encrypted", Buffer.alloc(0)],
          ["phone_encrypted", Buffer.alloc(0)],
          ["email_hmac", randomBytes(31)],
          ["phone_hmac", randomBytes(33)],
          ["hmac_key_version", 0],
        ]) {
          await expectQueryError(
            db,
            `UPDATE portal.candidates SET ${column} = $2 WHERE id = $1`,
            [first.id, value],
            "23514",
          );
        }
      },
    );

    await t.test(
      "enforces upload bounds, locators and capability uniqueness",
      async () => {
        const upload = await createUpload(1);
        const maximum = await createUpload(10_000_000);
        assert.equal(upload.declared_size_bytes, "1");
        assert.equal(maximum.declared_size_bytes, "10000000");
        assert.equal(upload.scan_state, "PENDING");
        assert.equal(upload.size_bytes, null);
        assert.equal(upload.sha256, null);
        for (const assignment of [
          "declared_size_bytes = 0",
          "declared_size_bytes = 10000001",
          "size_bytes = 0",
          "size_bytes = 10000001",
          "bucket = '  '",
          "object_key = '  '",
          "storage_provider = 'PUBLIC'",
          "scan_state = 'SKIPPED'",
          "capability_expires_at = created_at",
        ]) {
          await expectQueryError(
            db,
            `UPDATE portal.uploads SET ${assignment} WHERE id = $1`,
            [upload.id],
            "23514",
          );
        }
        for (const column of ["capability_hash", "sha256"]) {
          await expectQueryError(
            db,
            `UPDATE portal.uploads SET ${column} = $2 WHERE id = $1`,
            [upload.id, randomBytes(31)],
            "23514",
          );
        }
        await expectQueryError(
          db,
          "UPDATE portal.uploads SET object_key = $2 WHERE id = $1",
          [maximum.id, upload.object_key],
          "23505",
        );
        await expectQueryError(
          db,
          "UPDATE portal.uploads SET capability_hash = $2 WHERE id = $1",
          [maximum.id, upload.capability_hash],
          "23505",
        );
      },
    );

    await t.test(
      "requires complete scan metadata before a clean state",
      async () => {
        const upload = await createUpload();
        await expectQueryError(
          db,
          "UPDATE portal.uploads SET scan_state = 'CLEAN' WHERE id = $1",
          [upload.id],
          "23514",
        );
        await markClean(upload.id);
        for (const assignment of [
          "size_bytes = NULL",
          "sha256 = NULL",
          "scanned_at = NULL",
          "detected_type = NULL",
          "size_bytes = declared_size_bytes - 1",
          "detected_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'",
        ]) {
          await expectQueryError(
            db,
            `UPDATE portal.uploads SET ${assignment} WHERE id = $1`,
            [upload.id],
            "23514",
          );
        }
        const doc = await createUpload();
        await markClean(doc.id, "application/msword");
        const result = await db.query(
          "SELECT scan_state, detected_type FROM portal.uploads WHERE id = $1",
          [doc.id],
        );
        assert.deepEqual(result.rows, [
          { scan_state: "CLEAN", detected_type: "application/msword" },
        ]);
      },
    );

    await t.test(
      "persists intake before matching with consent and safe defaults",
      async () => {
        const application = await createApplication();
        assert.equal(application.intake_state, "RECEIVED");
        assert.equal(application.status, "NEW");
        assert.equal(application.version, 1);
        assert.equal(application.duplicate_candidate_match, false);
        assert.equal(application.candidate_id, null);
        assert.equal(application.cv_scan_state, null);
        assert.equal(application.confirmed_at, null);
        assert.equal(application.cover_letter_encrypted, null);
        assert.deepEqual(application.profile_encrypted, envelope);
        assert.ok(application.consent_at instanceof Date);
        for (const assignment of [
          "policy_version = '  '",
          "source = '  '",
          "locale = 'fr'",
          "version = 0",
          "intake_state = 'DONE'",
          "status = 'ACCEPTED'",
          "confirmed_at = now()",
          "profile_encrypted = ''::bytea",
          "cover_letter_encrypted = ''::bytea",
          "receipt_expires_at = submitted_at",
        ]) {
          await expectQueryError(
            db,
            `UPDATE portal.applications SET ${assignment} WHERE id = $1`,
            [application.id],
            "23514",
          );
        }
        for (const column of ["payload_digest", "receipt_hash"]) {
          await expectQueryError(
            db,
            `UPDATE portal.applications SET ${column} = $2 WHERE id = $1`,
            [application.id, randomBytes(31)],
            "23514",
          );
        }
        await expectQueryError(
          db,
          "UPDATE portal.applications SET consent_at = NULL WHERE id = $1",
          [application.id],
          "23502",
        );
        await db.query(
          "UPDATE portal.applications SET cover_letter_encrypted = $2, locale = 'en' WHERE id = $1",
          [application.id, envelope],
        );
      },
    );

    await t.test(
      "confirms only with a candidate and a clean referenced CV",
      async () => {
        const candidate = await createCandidate();
        const upload = await createUpload();
        const application = await createApplication(jobId, upload.id);
        await expectQueryError(
          db,
          "UPDATE portal.applications SET intake_state = 'CONFIRMED', confirmed_at = now(), candidate_id = $2 WHERE id = $1",
          [application.id, candidate.id],
          "23514",
        );
        await expectQueryError(
          db,
          "UPDATE portal.applications SET intake_state = 'CONFIRMED', confirmed_at = now(), candidate_id = $2, cv_scan_state = 'CLEAN' WHERE id = $1",
          [application.id, candidate.id],
          "23503",
        );
        for (const state of ["INFECTED", "ERROR"]) {
          await db.query(
            "UPDATE portal.uploads SET scan_state = $2 WHERE id = $1",
            [upload.id, state],
          );
          await expectQueryError(
            db,
            "UPDATE portal.applications SET intake_state = 'CONFIRMED', confirmed_at = now(), candidate_id = $2, cv_scan_state = 'CLEAN' WHERE id = $1",
            [application.id, candidate.id],
            "23503",
          );
        }
        await markClean(upload.id);
        const result = await db.query(
          "UPDATE portal.applications SET intake_state = 'CONFIRMED', confirmed_at = now(), candidate_id = $2, cv_scan_state = 'CLEAN' WHERE id = $1 RETURNING intake_state, cv_scan_state, candidate_id",
          [application.id, candidate.id],
        );
        assert.deepEqual(result.rows, [
          {
            intake_state: "CONFIRMED",
            cv_scan_state: "CLEAN",
            candidate_id: candidate.id,
          },
        ]);
        for (const column of [
          "candidate_id",
          "cv_scan_state",
          "confirmed_at",
        ]) {
          await expectQueryError(
            db,
            `UPDATE portal.applications SET ${column} = NULL WHERE id = $1`,
            [application.id],
            "23514",
          );
        }
        await expectQueryError(
          db,
          "UPDATE portal.applications SET cv_scan_state = 'PENDING' WHERE id = $1",
          [application.id],
          "23514",
        );
        await expectQueryError(
          db,
          "UPDATE portal.uploads SET scan_state = 'ERROR' WHERE id = $1",
          [upload.id],
          "23503",
        );
      },
    );

    await t.test(
      "scopes retry keys to jobs and permits separate repeat applications",
      async () => {
        const first = await createApplication();
        const second = await createApplication();
        await expectQueryError(
          db,
          "UPDATE portal.applications SET idempotency_key = $2 WHERE id = $1",
          [second.id, first.idempotency_key],
          "23505",
        );
        await db.query(
          "UPDATE portal.applications SET job_id = $2, idempotency_key = $3 WHERE id = $1",
          [second.id, otherJobId, first.idempotency_key],
        );
        await expectQueryError(
          db,
          "UPDATE portal.applications SET cv_upload_id = $2 WHERE id = $1",
          [second.id, first.cv_upload_id],
          "23505",
        );
        await expectQueryError(
          db,
          "UPDATE portal.applications SET receipt_hash = $2 WHERE id = $1",
          [second.id, first.receipt_hash],
          "23505",
        );
        const candidate = await createCandidate();
        const repeat = await createApplication();
        await db.query(
          "UPDATE portal.applications SET candidate_id = $2 WHERE id = $1",
          [first.id, candidate.id],
        );
        await db.query(
          "UPDATE portal.applications SET candidate_id = $2, duplicate_candidate_match = true WHERE id = $1",
          [repeat.id, candidate.id],
        );
        const matches = await db.query(
          "SELECT count(*)::int AS count FROM portal.applications WHERE job_id = $1 AND candidate_id = $2",
          [jobId, candidate.id],
        );
        assert.deepEqual(matches.rows, [{ count: 2 }]);
      },
    );

    await t.test(
      "rejects orphan references and protects referenced records",
      async () => {
        const candidate = await createCandidate();
        const application = await createApplication();
        await db.query(
          "UPDATE portal.applications SET candidate_id = $2 WHERE id = $1",
          [application.id, candidate.id],
        );
        for (const column of ["job_id", "candidate_id", "cv_upload_id"]) {
          await expectQueryError(
            db,
            `UPDATE portal.applications SET ${column} = $2 WHERE id = $1`,
            [application.id, randomUUID()],
            "23503",
          );
        }
        for (const [table, id] of [
          ["jobs", jobId],
          ["candidates", candidate.id],
          ["uploads", application.cv_upload_id],
        ]) {
          await expectQueryError(
            db,
            `DELETE FROM portal.${table} WHERE id = $1`,
            [id],
            "23503",
          );
        }
        await expectQueryError(
          db,
          "UPDATE portal.applications SET idempotency_key = 'invalid' WHERE id = $1",
          [application.id],
          "22P02",
        );
      },
    );

    await t.test(
      "rolls back related intake writes after a failed operation",
      async () => {
        let candidateId, uploadId, applicationId;
        await db.query("SAVEPOINT atomic_intake");
        try {
          candidateId = (await createCandidate()).id;
          const upload = await createUpload();
          uploadId = upload.id;
          const application = await createApplication(jobId, upload.id);
          applicationId = application.id;
          await db.query(
            "UPDATE portal.applications SET candidate_id = $2 WHERE id = $1",
            [application.id, candidateId],
          );
          await assert.rejects(
            db.query(
              "INSERT INTO portal.applications SELECT * FROM portal.applications WHERE id = $1",
              [application.id],
            ),
            { code: "23505" },
          );
        } finally {
          await db.query("ROLLBACK TO SAVEPOINT atomic_intake");
          await db.query("RELEASE SAVEPOINT atomic_intake");
        }
        const remaining = await db.query(
          "SELECT (SELECT count(*) FROM portal.candidates WHERE id = $1)::int AS candidates, (SELECT count(*) FROM portal.uploads WHERE id = $2)::int AS uploads, (SELECT count(*) FROM portal.applications WHERE id = $3)::int AS applications",
          [candidateId, uploadId, applicationId],
        );
        assert.deepEqual(remaining.rows, [
          { candidates: 0, uploads: 0, applications: 0 },
        ]);
      },
    );

    await t.test(
      "uses UUID references and database-maintained timestamps",
      async () => {
        const columns = await db.query(
          "SELECT udt_name FROM information_schema.columns WHERE table_schema = 'portal' AND ((table_name IN ('candidates', 'uploads') AND column_name = 'id') OR (table_name = 'applications' AND column_name IN ('id', 'job_id', 'candidate_id', 'cv_upload_id', 'idempotency_key')))",
        );
        assert.equal(columns.rows.length, 7);
        assert.ok(columns.rows.every((column) => column.udt_name === "uuid"));
        const candidate = await createCandidate();
        const upload = await createUpload();
        const application = await createApplication(jobId, upload.id);
        for (const [table, id] of [
          ["candidates", candidate.id],
          ["uploads", upload.id],
          ["applications", application.id],
        ]) {
          const updated = await db.query(
            `UPDATE portal.${table} SET updated_at = '2000-01-01'::timestamptz WHERE id = $1 RETURNING updated_at = transaction_timestamp() AS touched`,
            [id],
          );
          assert.deepEqual(updated.rows, [{ touched: true }]);
        }
        const indexes = await db.query(
          "SELECT indexname FROM pg_indexes WHERE schemaname = 'portal' AND tablename IN ('candidates', 'uploads', 'applications')",
        );
        const names = new Set(indexes.rows.map((row) => row.indexname));
        for (const name of [
          "candidates_email_idx",
          "candidates_phone_idx",
          "uploads_scan_idx",
          "applications_job_status_idx",
          "applications_candidate_idx",
          "applications_intake_idx",
        ]) {
          assert.ok(names.has(name), name);
        }
      },
    );

    await t.test(
      "denies ungranted access to candidate, upload and application data",
      async () => {
        const tables = ["candidates", "uploads", "applications"];
        const flags = await db.query(
          "SELECT relrowsecurity FROM pg_class WHERE oid IN ('portal.candidates'::regclass, 'portal.uploads'::regclass, 'portal.applications'::regclass)",
        );
        assert.equal(flags.rows.length, 3);
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
      },
    );
  },
);
