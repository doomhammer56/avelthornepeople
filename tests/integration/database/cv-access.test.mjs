import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createStaffFixture, expectQueryError } from "./helpers.mjs";

test(
  "CV revocation and scoped audit authorization",
  { timeout: 180_000 },
  async (t) => {
    assert.ok(process.env.DIRECT_URL, "DIRECT_URL is required.");
    const db = new pg.Client({
      connectionString: process.env.DIRECT_URL,
      connectionTimeoutMillis: 15000,
      statement_timeout: 15000,
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
    await db.query("GRANT portal_runtime TO CURRENT_USER");
    const staffId = await createStaffFixture(db);
    const job = (
      await db.query(
        "INSERT INTO portal.jobs (canonical_slug,draft_content,owner_id) VALUES ($1,'{}'::jsonb,$2) RETURNING id",
        [randomUUID(), staffId],
      )
    ).rows[0].id;
    const candidate = (
      await db.query(
        "INSERT INTO portal.candidates (name_encrypted,email_encrypted,phone_encrypted,email_hmac,phone_hmac,hmac_key_version) VALUES ($1,$1,$1,$2,$3,1) RETURNING id",
        [randomBytes(48), randomBytes(32), randomBytes(32)],
      )
    ).rows[0].id;
    const upload = (
      await db.query(
        `INSERT INTO portal.uploads (storage_provider,bucket,object_key,declared_size_bytes,size_bytes,detected_type,sha256,scan_state,scanned_at,capability_hash,capability_expires_at,provider_upload_expires_at)
    VALUES ('SUPABASE','cv-clean',$1,100,100,'application/pdf',$2,'CLEAN',now(),$3,now()+interval '15 minutes',now()+interval '2 hours') RETURNING id`,
        [randomUUID(), randomBytes(32), randomBytes(32)],
      )
    ).rows[0].id;
    const application = (
      await db.query(
        `INSERT INTO portal.applications (job_id,candidate_id,cv_upload_id,cv_scan_state,intake_state,confirmed_at,profile_encrypted,consent_at,policy_version,source,locale,idempotency_key,payload_digest,receipt_hash,receipt_expires_at)
    VALUES ($1,$2,$3,'CLEAN','CONFIRMED',now(),$4,now(),'v1','CAREERS','en',$5,$6,$7,now()+interval '1 day') RETURNING id`,
        [
          job,
          candidate,
          upload,
          randomBytes(48),
          randomUUID(),
          randomBytes(32),
          randomBytes(32),
        ],
      )
    ).rows[0].id;

    async function asStaff(role, action, active = true) {
      await db.query(
        "UPDATE portal.staff_profiles SET role=$2,active=$3 WHERE id=$1",
        [staffId, role, active],
      );
      await db.query("SAVEPOINT actor");
      try {
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
          staffId,
        ]);
        await db.query("SET LOCAL ROLE portal_runtime");
        await action();
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT actor");
        await db.query("RELEASE SAVEPOINT actor");
      }
    }

    await t.test(
      "HR/Admin record only allowlisted CV audit references",
      async () => {
        for (const role of ["HR", "ADMIN"]) {
          await asStaff(role, async () => {
            const requestId = randomUUID();
            await db.query("SELECT portal_private.record_cv_access($1,$2)", [
              application,
              requestId,
            ]);
            await db.query("RESET ROLE");
            const rows = (
              await db.query(
                "SELECT actor_id,object_type,object_id,action,safe_changes FROM portal.audit_logs WHERE request_id=$1",
                [requestId],
              )
            ).rows;
            assert.deepEqual(rows, [
              {
                actor_id: staffId,
                object_type: "APPLICATION",
                object_id: application,
                action: "CV_URL_ISSUED",
                safe_changes: { uploadId: upload },
              },
            ]);
          });
        }
      },
    );

    await t.test(
      "read-only and inactive users cannot create CV access audits",
      async () => {
        for (const [role, active] of [
          ["READ_ONLY", true],
          ["ADMIN", false],
        ]) {
          await asStaff(
            role,
            () =>
              expectQueryError(
                db,
                "SELECT portal_private.record_cv_access($1,$2)",
                [application, randomUUID()],
                "42501",
              ),
            active,
          );
        }
      },
    );

    await t.test(
      "revocation hides the clean upload without breaking confirmed application integrity",
      async () => {
        await db.query(
          "UPDATE portal.uploads SET access_revoked_at=now() WHERE id=$1",
          [upload],
        );
        await asStaff("HR", async () => {
          assert.deepEqual(
            (
              await db.query("SELECT id FROM portal.uploads WHERE id=$1", [
                upload,
              ])
            ).rows,
            [],
          );
          assert.equal(
            (
              await db.query("SELECT id FROM portal.applications WHERE id=$1", [
                application,
              ])
            ).rowCount,
            1,
          );
          await expectQueryError(
            db,
            "SELECT portal_private.record_cv_access($1,$2)",
            [application, randomUUID()],
            "42501",
          );
        });
        await db.query(
          "UPDATE portal.uploads SET access_revoked_at=NULL WHERE id=$1",
          [upload],
        );
      },
    );

    await t.test(
      "deletion, quarantine and unavailable applications cannot be signed/audited",
      async () => {
        for (const change of [
          [
            "UPDATE portal.candidates SET deletion_requested_at=now() WHERE id=$1",
            candidate,
          ],
          [
            "UPDATE portal.uploads SET bucket='cv-quarantine' WHERE id=$1",
            upload,
          ],
          [
            "UPDATE portal.applications SET intake_state='UNAVAILABLE',confirmed_at=NULL WHERE id=$1",
            application,
          ],
        ]) {
          await db.query("SAVEPOINT unavailable");
          try {
            await db.query(change[0], [change[1]]);
            await asStaff("ADMIN", () =>
              expectQueryError(
                db,
                "SELECT portal_private.record_cv_access($1,$2)",
                [application, randomUUID()],
                "42501",
              ),
            );
          } finally {
            await db.query("ROLLBACK TO SAVEPOINT unavailable");
            await db.query("RELEASE SAVEPOINT unavailable");
          }
        }
      },
    );

    await t.test(
      "provider/public-reader roles cannot execute the private audit function",
      async () => {
        const rows = (
          await db.query(
            "SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','portal_public_reader') AND has_function_privilege(oid,'portal_private.record_cv_access(uuid,uuid)','EXECUTE')",
          )
        ).rows;
        assert.deepEqual(rows, []);
        await asStaff("HR", () =>
          expectQueryError(
            db,
            "UPDATE portal.uploads SET access_revoked_at=NULL",
            [],
            "42501",
          ),
        );
      },
    );
  },
);
