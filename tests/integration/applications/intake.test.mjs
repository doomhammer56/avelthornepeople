import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
import { createStaffFixture, expectQueryError } from "../database/helpers.mjs";
loadAuthTestEnvironment();

test(
  "Public intake atomically accepts unscanned private CVs, deduplicates and rejects closed jobs/capabilities",
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
    t.after(async () => {
      await db.query("ROLLBACK").catch(() => {});
      await db.end();
    });
    await db.query("BEGIN");
    if (
      !(
        await db.query(
          "SELECT to_regprocedure('portal_private.application_upload(uuid,bytea)') IS NOT NULL ready",
        )
      ).rows[0].ready
    )
      await db.query(
        readFileSync(
          "prisma/migrations/20261026000400_public_application_intake/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, "")
          .replace(/COMMIT;\s*$/, ""),
      );
    const owner = (await db.query("SELECT current_user name")).rows[0].name;
    await db.query(`GRANT portal_runtime TO ${pg.escapeIdentifier(owner)}`);
    const staff = await createStaffFixture(db);
    const d = (
      await db.query(
        "INSERT INTO portal.departments(code,name_en,name_zh) VALUES($1,'Intake','测试') RETURNING id",
        [randomUUID()],
      )
    ).rows[0].id;
    const l = (
      await db.query(
        "INSERT INTO portal.locations(code,name_en,name_zh,country_code,timezone) VALUES($1,'Test','测试','MY','Asia/Kuala_Lumpur') RETURNING id",
        [randomUUID()],
      )
    ).rows[0].id;
    const content = {
      en: {
        title: "Intake role",
        responsibilities: ["Work"],
        requirements: ["Skill"],
      },
      zh: { title: "职位", responsibilities: ["职责"], requirements: ["要求"] },
    };
    const job = (
      await db.query(
        "INSERT INTO portal.jobs(canonical_slug,status,draft_content,published_content,published_version,department_id,job_type,experience,owner_id,approved_by,approved_at,publish_at) VALUES($1,'PUBLISHED',$2,$2,1,$3,'FULL_TIME','ANY',$4,$4,now(),now()-interval '1 minute') RETURNING id",
        [`intake-${randomUUID()}`, JSON.stringify(content), d, staff],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO portal.job_locations(job_id,location_id) VALUES($1,$2)",
      [job, l],
    );
    const request = randomUUID(),
      upload = randomUUID(),
      cap = randomBytes(32),
      bytes = randomBytes(32),
      envelope = randomBytes(80),
      id = randomUUID();
    const email = randomBytes(32).toString("hex"),
      phone = randomBytes(32).toString("hex");
    const keys = [
      { version: 1, field: "email", hash: email },
      { version: 1, field: "phone", hash: phone },
    ];
    await db.query("SET LOCAL ROLE portal_runtime");
    await db.query(
      "SELECT portal_private.reserve_application_upload($1,$2,$3,$4,100,$5)",
      [job, request, upload, `${upload}/${randomUUID()}.pdf`, cap],
    );
    const params = [
      job,
      request,
      upload,
      cap,
      "application/pdf",
      100,
      bytes,
      id,
      envelope,
      null,
      "en",
      randomBytes(32),
      randomUUID(),
      envelope,
      envelope,
      envelope,
      JSON.stringify(keys),
      1,
    ];
    const accept =
      "SELECT portal_private.accept_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) status";
    await expectQueryError(
      db,
      accept,
      params.map((p, i) => (i === 3 ? randomBytes(32) : p)),
      "22023",
    );
    assert.equal((await db.query(accept, params)).rows[0].status, "accepted");
    assert.equal((await db.query(accept, params)).rows[0].status, "duplicate");
    await expectQueryError(
      db,
      accept,
      params.map((p, i) => (i === 11 ? randomBytes(32) : p)),
      "40001",
    );
    await db.query("RESET ROLE");
    const row = (
      await db.query(
        "SELECT a.*,u.scan_state,u.scanned_at,u.bucket FROM portal.applications a JOIN portal.uploads u ON u.id=a.cv_upload_id WHERE a.id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(row.intake_state, "CONFIRMED");
    assert.equal(row.scan_state, "UNSCANNED");
    assert.equal(row.scanned_at, null);
    assert.equal(row.bucket, "cv-quarantine");
    assert.equal(row.submission_channel, "PUBLIC_SITE");
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT count(*) FROM portal.audit_logs WHERE object_id=$1 AND action='CONFIRMED'",
            [id],
          )
        ).rows[0].count,
      ),
      1,
    );
    const candidate = row.candidate_id;
    const nextRequest = randomUUID(),
      nextUpload = randomUUID();
    await db.query("SET LOCAL ROLE portal_runtime");
    await db.query(
      "SELECT portal_private.reserve_application_upload($1,$2,$3,$4,100,$5)",
      [
        job,
        nextRequest,
        nextUpload,
        `${nextUpload}/${randomUUID()}.pdf`,
        cap.map((v) => v ^ 1),
      ],
    );
    const next = params.map(
      (p, i) =>
        ({
          1: nextRequest,
          2: nextUpload,
          3: cap.map((v) => v ^ 1),
          7: randomUUID(),
          12: randomUUID(),
        })[i] ?? p,
    );
    assert.equal((await db.query(accept, next)).rows[0].status, "accepted");
    await db.query("RESET ROLE");
    assert.equal(
      (
        await db.query(
          "SELECT candidate_id FROM portal.applications WHERE id=$1",
          [next[7]],
        )
      ).rows[0].candidate_id,
      candidate,
    );
    const orphan = randomUUID();
    await db.query("SET LOCAL ROLE portal_runtime");
    await db.query(
      "SELECT portal_private.reserve_application_upload($1,$2,$3,$4,100,$5)",
      [
        job,
        randomUUID(),
        orphan,
        `${orphan}/${randomUUID()}.pdf`,
        randomBytes(32),
      ],
    );
    await db.query("RESET ROLE");
    await db.query(
      "UPDATE portal.uploads SET created_at=now()-interval '1 day',capability_expires_at=now()-interval '1 hour',provider_upload_expires_at=now()-interval '10 minutes' WHERE id=$1",
      [orphan],
    );
    await db.query("SET LOCAL ROLE portal_runtime");
    const expired = (
      await db.query(
        "SELECT portal_private.expired_application_uploads() expired",
      )
    ).rows[0].expired;
    assert.ok(expired.some((row) => row.id === orphan));
    assert.ok(!expired.some((row) => row.id === upload));
    await db.query(
      "SELECT portal_private.remove_expired_application_upload($1)",
      [orphan],
    );
    const traffic = randomUUID();
    for (let i = 0; i < 12; i++)
      assert.equal(
        (
          await db.query(
            "SELECT portal_private.consume_intake_traffic($1) retry",
            [traffic],
          )
        ).rows[0].retry,
        0,
      );
    assert.ok(
      (
        await db.query(
          "SELECT portal_private.consume_intake_traffic($1) retry",
          [traffic],
        )
      ).rows[0].retry > 0,
    );
    await db.query("RESET ROLE");
    assert.equal(
      Number(
        (
          await db.query("SELECT count(*) n FROM portal.uploads WHERE id=$1", [
            orphan,
          ])
        ).rows[0].n,
      ),
      0,
    );
    await db.query("UPDATE portal.jobs SET status='CLOSED' WHERE id=$1", [job]);
    await db.query("SET LOCAL ROLE portal_runtime");
    await expectQueryError(
      db,
      "SELECT portal_private.reserve_application_upload($1,$2,$3,$4,100,$5)",
      [job, randomUUID(), randomUUID(), `${upload}/${randomUUID()}.pdf`, cap],
      "22023",
    );
    const closedUpload = randomUUID();
    await expectQueryError(
      db,
      "SELECT portal_private.reserve_application_upload($1,$2,$3,$4,100,$5)",
      [
        job,
        randomUUID(),
        closedUpload,
        `${closedUpload}/${randomUUID()}.pdf`,
        randomBytes(32),
      ],
      "P0002",
    );
  },
);
