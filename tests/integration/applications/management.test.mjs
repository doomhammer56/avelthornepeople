import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
loadAuthTestEnvironment();
const { authAdminClient } =
  await import("../../../src/server/adapters/auth/admin.ts");
const { identityClient } =
  await import("../../../src/server/adapters/auth/config.ts");
test(
  "Recruitment commands preserve history and enforce authorization in the guarded test database",
  { timeout: 180000 },
  async (t) => {
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client({
          connectionString: process.env.DIRECT_URL,
          connectionTimeoutMillis: 15000,
          statement_timeout: 15000,
        }),
    );
    const admin = authAdminClient();
    let user;
    t.after(async () => {
      await db.query("ROLLBACK").catch(() => {});
      await db.end();
      if (user)
        assert.equal((await admin.auth.admin.deleteUser(user.id)).error, null);
    });
    const email = `be05-${randomUUID()}@example.invalid`,
      created = await admin.auth.admin.createUser({
        email,
        password: randomBytes(32).toString("base64url"),
        email_confirm: true,
      });
    assert.equal(created.error, null);
    user = created.data.user;
    const link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    assert.equal(link.error, null);
    const verified = await identityClient().auth.verifyOtp({
      type: "magiclink",
      token_hash: link.data.properties.hashed_token,
    });
    assert.equal(verified.error, null);
    const session = JSON.parse(
      Buffer.from(
        verified.data.session.access_token.split(".")[1],
        "base64url",
      ).toString(),
    ).session_id;
    await db.query("BEGIN");
    if (
      !(
        await db.query(
          "SELECT to_regprocedure('portal_private.manage_recruitment(text,uuid,integer,uuid,text,uuid,integer)') IS NOT NULL ready",
        )
      ).rows[0].ready
    )
      await db.query(
        readFileSync(
          "prisma/migrations/20261025000400_application_management/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, "")
          .replace(/COMMIT;\s*$/, ""),
      );
    await db.query(
      readFileSync(
        "prisma/migrations/20261025000500_candidate_trigger_access/migration.sql",
        "utf8",
      )
        .replace(/^BEGIN;/, "")
        .replace(/COMMIT;\s*$/, ""),
    );
    await db.query(
      readFileSync(
        "prisma/migrations/20261025000600_candidate_attachment_integrity/migration.sql",
        "utf8",
      )
        .replace(/^BEGIN;/, "")
        .replace(/COMMIT;\s*$/, ""),
    );
    const owner = (await db.query("SELECT current_user name")).rows[0].name;
    await db.query(`GRANT portal_runtime TO ${pg.escapeIdentifier(owner)}`);
    await db.query(
      "INSERT INTO portal.staff_profiles(id,display_name,role,active) VALUES($1,'BE05 fixture','HR',true)",
      [user.id],
    );
    await db.query(
      "INSERT INTO portal_private.staff_session_admissions(session_id,subject_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [session, user.id],
    );
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [user.id, JSON.stringify({ sub: user.id, session_id: session })],
    );
    const job = (
      await db.query(
        "INSERT INTO portal.jobs(canonical_slug,draft_content,owner_id) VALUES($1,'{}',$2) RETURNING id",
        [`be05-${randomUUID()}`, user.id],
      )
    ).rows[0].id;
    async function candidate() {
      return (
        await db.query(
          "INSERT INTO portal.candidates(name_encrypted,email_encrypted,phone_encrypted,email_hmac,phone_hmac,hmac_key_version) VALUES($1,$1,$1,$2,$3,1) RETURNING id",
          [randomBytes(48), randomBytes(32), randomBytes(32)],
        )
      ).rows[0].id;
    }
    async function application(id) {
      const upload = (
        await db.query(
          "INSERT INTO portal.uploads(storage_provider,bucket,object_key,declared_size_bytes,size_bytes,detected_type,sha256,scan_state,scanned_at,capability_hash,capability_expires_at) VALUES('SUPABASE','cv-clean',$1,100,100,'application/pdf',$2,'CLEAN',now(),$3,now()+interval '1 hour') RETURNING id",
          [`be05/${randomUUID()}`, randomBytes(32), randomBytes(32)],
        )
      ).rows[0].id;
      return (
        await db.query(
          "INSERT INTO portal.applications(job_id,candidate_id,cv_upload_id,cv_scan_state,intake_state,status,profile_encrypted,consent_at,policy_version,source,locale,idempotency_key,payload_digest,receipt_hash,receipt_expires_at,confirmed_at) VALUES($1,$2,$3,'CLEAN','CONFIRMED','NEW',$4,now(),'v1','CAREERS','en',$5,$6,$7,now()+interval '1 hour',now()) RETURNING *",
          [
            job,
            id,
            upload,
            randomBytes(48),
            randomUUID(),
            randomBytes(32),
            randomBytes(32),
          ],
        )
      ).rows[0];
    }
    async function scope(action) {
      await db.query("SAVEPOINT command_scope");
      try {
        await db.query("SET LOCAL ROLE portal_runtime");
        const result = await action();
        await db.query("RESET ROLE");
        await db.query("RELEASE SAVEPOINT command_scope");
        return result;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT command_scope");
        await db.query("RELEASE SAVEPOINT command_scope");
        throw error;
      }
    }
    const call = (
      kind,
      id,
      version,
      request = randomUUID(),
      status = null,
      source = null,
      sourceVersion = null,
    ) =>
      scope(
        async () =>
          (
            await db.query(
              "SELECT portal_private.manage_recruitment($1,$2,$3,$4,$5,$6,$7) result",
              [kind, id, version, request, status, source, sourceVersion],
            )
          ).rows[0].result,
      );
    const a = await candidate(),
      b = await candidate(),
      c = await candidate();
    const app = await application(b),
      other = await application(a);
    await t.test("Direct unaudited stage writes are revoked", async () => {
      await assert.rejects(
        scope(() =>
          db.query(
            "UPDATE portal.applications SET status='OFFER' WHERE id=$1",
            [app.id],
          ),
        ),
        (e) => e.code === "42501",
      );
    });
    await t.test(
      "Stage writes are atomic, versioned and replay safely",
      async () => {
        const request = randomUUID();
        const first = await call("stage", app.id, 1, request, "INTERVIEW");
        assert.equal(first.version, 2);
        assert.deepEqual(
          await call("stage", app.id, 1, request, "INTERVIEW"),
          first,
        );
        await assert.rejects(
          call("stage", app.id, 1, request, "OFFER"),
          (e) => e.code === "40001",
        );
        await assert.rejects(
          call("stage", app.id, 1, randomUUID(), "OFFER"),
          (e) => e.code === "40001",
        );
        assert.equal(
          Number(
            (
              await db.query(
                "SELECT count(*) n FROM portal.audit_logs WHERE request_id=$1",
                [request],
              )
            ).rows[0].n,
          ),
          1,
        );
      },
    );
    const mergeRequest = randomUUID();
    await t.test(
      "Merge retains applications, CV and consent snapshots and supports idempotent retries",
      async () => {
        const result = await call("merge", a, 1, mergeRequest, null, b, 1);
        assert.equal(result.applicationsMoved, 1);
        assert.deepEqual(
          await call("merge", a, 1, mergeRequest, null, b, 1),
          result,
        );
        const saved = (
          await db.query("SELECT * FROM portal.applications WHERE id=$1", [
            app.id,
          ])
        ).rows[0];
        assert.equal(saved.candidate_id, a);
        assert.equal(saved.status, "INTERVIEW");
        assert.equal(saved.cv_upload_id, app.cv_upload_id);
        assert.deepEqual(saved.profile_encrypted, app.profile_encrypted);
        assert.equal(
          saved.consent_at.toISOString(),
          app.consent_at.toISOString(),
        );
        assert.equal(saved.version, 3);
        assert.equal(
          Number(
            (
              await db.query(
                "SELECT count(*) n FROM portal.applications WHERE id=ANY($1::uuid[])",
                [[app.id, other.id]],
              )
            ).rows[0].n,
          ),
          2,
        );
      },
    );
    await t.test("Self/stale/already-merged sources are rejected", async () => {
      await assert.rejects(
        call("merge", a, 2, randomUUID(), null, a, 2),
        (e) => e.code === "22023",
      );
      await assert.rejects(
        call("merge", a, 2, randomUUID(), null, b, 2),
        (e) => e.code === "40001",
      );
      await assert.rejects(
        call("merge", c, 1, randomUUID(), null, a, 1),
        (e) => e.code === "40001",
      );
    });
    await t.test(
      "Later merges flatten aliases and future attachments canonicalize old IDs",
      async () => {
        await call("merge", c, 1, randomUUID(), null, a, 2);
        for (const id of [a, b])
          assert.equal(
            (
              await db.query(
                "SELECT merged_into_id FROM portal.candidates WHERE id=$1",
                [id],
              )
            ).rows[0].merged_into_id,
            c,
          );
        const added = await application(b);
        assert.equal(added.candidate_id, c);
      },
    );
    await t.test(
      "A deletion request for any alias blocks group reads, CV issuance and further merges",
      async () => {
        await db.query(
          "INSERT INTO portal.deletion_requests(candidate_id,verified_requester_ref,state,reason_code,due_at) VALUES($1,$2,'REQUESTED','TEST',now()+interval '1 day')",
          [b, randomUUID()],
        );
        assert.equal(
          (
            await scope(() =>
              db.query(
                "SELECT portal_private.candidate_group_blocked($1) blocked",
                [c],
              ),
            )
          ).rows[0].blocked,
          true,
        );
        await assert.rejects(
          call("stage", app.id, 4, randomUUID(), "OFFER"),
          (e) => e.code === "55000",
        );
        await assert.rejects(
          scope(() =>
            db.query("SELECT portal_private.record_cv_access($1,$2)", [
              app.id,
              randomUUID(),
            ]),
          ),
          (e) => e.code === "42501",
        );
      },
    );
    await t.test(
      "READ_ONLY and inactive staff cannot mutate or inspect candidate rows",
      async () => {
        await db.query(
          "UPDATE portal.staff_profiles SET role='READ_ONLY' WHERE id=$1",
          [user.id],
        );
        assert.equal(
          (await scope(() => db.query("SELECT id FROM portal.candidates"))).rows
            .length,
          0,
        );
        await assert.rejects(
          call("stage", other.id, 1, randomUUID(), "OFFER"),
          (e) => e.code === "42501",
        );
        await db.query(
          "UPDATE portal.staff_profiles SET active=false WHERE id=$1",
          [user.id],
        );
        await assert.rejects(
          call("merge", a, 1, randomUUID(), null, b, 1),
          (e) => e.code === "42501",
        );
      },
    );
  },
);
