import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
import { createStaffFixture, expectQueryError } from "../database/helpers.mjs";
import { readDashboard } from "../../../src/server/dashboard/repository.ts";
import { dashboardPeriod } from "../../../src/server/dashboard/contract.ts";
loadAuthTestEnvironment();
test(
  "Dashboard migration, aggregate definitions and restricted collection (rolled back)",
  { timeout: 120000 },
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
      await db.query("ROLLBACK");
      await db.end();
    });
    await db.query("BEGIN");
    if (
      !(
        await db.query(
          "SELECT to_regprocedure('portal_private.record_job_detail_view(uuid,text,text,uuid)') IS NOT NULL AS present",
        )
      ).rows[0].present
    )
      await db.query(
        readFileSync(
          "prisma/migrations/20261023000100_dashboard_metrics/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, "")
          .replace(/COMMIT;\s*$/, ""),
      );
    await db.query(
      "GRANT portal_metrics_writer,portal_runtime TO CURRENT_USER",
    );
    const staff = await createStaffFixture(db);
    await db.query(
      "UPDATE portal.staff_profiles SET active=true,role='ADMIN' WHERE id=$1",
      [staff],
    );
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      staff,
    ]);
    const asRole = async (role, fn) => {
      await db.query("SET LOCAL ROLE " + pg.escapeIdentifier(role));
      try {
        return await fn();
      } finally {
        await db.query("RESET ROLE");
      }
    };
    const read = async () => {
      const clock = (await db.query("SELECT statement_timestamp() AS now"))
        .rows[0].now;
      return asRole("portal_runtime", () =>
        readDashboard(db, dashboardPeriod(7, clock)),
      );
    };
    const baseline = await read();
    const jobs = [];
    for (let i = 0; i < 4; i++)
      jobs.push(
        (
          await db.query(
            "INSERT INTO portal.jobs (canonical_slug,draft_content,owner_id) VALUES ($1,'{}',$2) RETURNING id",
            [randomUUID(), staff],
          )
        ).rows[0].id,
      );
    const [live, draft, expired, future] = jobs;
    const department = (
      await db.query(
        "INSERT INTO portal.departments(code,name_zh) VALUES($1,'Test') RETURNING id",
        [randomUUID()],
      )
    ).rows[0].id;
    for (const [id, offset, close] of [
      [live, "-1 day", "1 day"],
      [expired, "-2 days", "-1 day"],
      [future, "1 day", "2 days"],
    ])
      await db.query(
        "UPDATE portal.jobs SET status='PUBLISHED',published_content='{}',published_version=1,approved_by=$2,approved_at=now(),first_published_at=now(),publish_at=now()+$3::interval,close_at=now()+$4::interval,department_id=$5,job_type='FULL_TIME',experience='ANY' WHERE id=$1",
        [id, staff, offset, close, department],
      );
    const candidate = (
      await db.query(
        "INSERT INTO portal.candidates(name_encrypted,email_encrypted,phone_encrypted,email_hmac,phone_hmac,hmac_key_version) VALUES($1,$1,$1,$2,$3,1) RETURNING id",
        [randomBytes(48), randomBytes(32), randomBytes(32)],
      )
    ).rows[0].id;
    for (const [channel, confirmed, age] of [
      ["PUBLIC_SITE", true, "0 days"],
      ["IMPORT", true, "1 day"],
      [null, true, "2 days"],
      ["PUBLIC_SITE", false, "0 days"],
      ["PUBLIC_SITE", true, "10 days"],
    ]) {
      const upload = (
        await db.query(
          "INSERT INTO portal.uploads(storage_provider,bucket,object_key,declared_size_bytes,size_bytes,detected_type,sha256,scan_state,scanned_at,capability_hash,capability_expires_at) VALUES('SUPABASE','cv-clean',$1,100,100,'application/pdf',$2,'CLEAN',now(),$3,now()+interval '1 day') RETURNING id",
          [randomUUID(), randomBytes(32), randomBytes(32)],
        )
      ).rows[0].id;
      await db.query(
        "INSERT INTO portal.applications(job_id,candidate_id,cv_upload_id,cv_scan_state,intake_state,confirmed_at,profile_encrypted,consent_at,policy_version,source,locale,idempotency_key,payload_digest,receipt_hash,receipt_expires_at,submission_channel,submitted_at) VALUES($1,$2,$3,'CLEAN',$4,CASE WHEN $4='CONFIRMED' THEN now() END,$5,now(),'v1','linkedin','en',$6,$7,$8,now()+interval '1 day',$9,now()-$10::interval)",
        [
          live,
          candidate,
          upload,
          confirmed ? "CONFIRMED" : "RECEIVED",
          randomBytes(48),
          randomUUID(),
          randomBytes(32),
          randomBytes(32),
          channel,
          age,
        ],
      );
    }
    const key = randomUUID();
    const collect = (
      job = live,
      locale = "en",
      source = "linkedin",
      ip = key,
    ) =>
      asRole(
        "portal_metrics_writer",
        async () =>
          (
            await db.query(
              "SELECT portal_private.record_job_detail_view($1,$2,$3,$4) AS retry",
              [job, locale, source, ip],
            )
          ).rows[0].retry,
      );
    await t.test(
      "Collection is disabled until explicit enablement",
      async () => {
        await db.query(
          "UPDATE portal_private.analytics_state SET started_at=NULL",
        );
        assert.equal(await collect(), -1);
        await db.query(
          "UPDATE portal_private.analytics_state SET started_at=now()-interval '30 days'",
        );
      },
    );
    await t.test(
      "Only eligible public jobs increment; both locales count",
      async () => {
        for (const id of [draft, expired, future, randomUUID()])
          assert.equal(await collect(id), 0);
        assert.equal(await collect(live), 0);
        assert.equal(await collect(live, "zh", "direct"), 0);
        assert.equal(
          (
            await db.query(
              "SELECT sum(page_views)::text AS total FROM portal.daily_metrics WHERE job_id=$1",
              [live],
            )
          ).rows[0].total,
          "2",
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::text AS total FROM portal.daily_metrics WHERE job_id=ANY($1)",
              [[draft, expired, future]],
            )
          ).rows[0].total,
          "0",
        );
      },
    );
    await t.test(
      "Separate aggregates exclude incomplete/out-of-range applications and fill zero dates",
      async () => {
        const result = await read();
        assert.equal(result.totalJobs - baseline.totalJobs, 4);
        assert.equal(result.liveJobs - baseline.liveJobs, 1);
        assert.equal(result.expiredLiveJobs - baseline.expiredLiveJobs, 1);
        assert.equal(result.applications - baseline.applications, 3);
        assert.equal(
          result.publicSiteApplications - baseline.publicSiteApplications,
          1,
        );
        assert.equal(
          result.unknownChannelApplications -
            baseline.unknownChannelApplications,
          1,
        );
        assert.equal(result.detailViews - baseline.detailViews, 2);
        assert.equal(result.dailyApplications.length, 7);
        assert.equal(result.conversionRate, null);
      },
    );
    await t.test(
      "Runtime and browser roles cannot collect; writer cannot read or mutate arbitrary rows",
      async () => {
        for (const role of [
          "portal_runtime",
          "anon",
          "authenticated",
          "service_role",
        ])
          await asRole(role, () =>
            expectQueryError(
              db,
              "SELECT portal_private.record_job_detail_view($1,'en','direct',$2)",
              [live, key],
              "42501",
            ),
          );
        await asRole("portal_metrics_writer", async () => {
          await expectQueryError(
            db,
            "SELECT * FROM portal.daily_metrics",
            [],
            "42501",
          );
          await expectQueryError(
            db,
            "UPDATE portal_private.analytics_state SET started_at=now()",
            [],
            "42501",
          );
          await expectQueryError(
            db,
            "SELECT portal_private.record_job_detail_view($1,'en','invalid',$2)",
            [live, key],
            "22023",
          );
        });
        await db.query(
          "UPDATE portal.staff_profiles SET role='READ_ONLY' WHERE id=$1",
          [staff],
        );
        await asRole("portal_runtime", async () =>
          assert.equal(
            (await db.query("SELECT * FROM portal_private.analytics_state"))
              .rowCount,
            0,
          ),
        );
        await db.query(
          "UPDATE portal.staff_profiles SET role='HR' WHERE id=$1",
          [staff],
        );
        assert.equal((await read()).applications - baseline.applications, 3);
      },
    );
    await t.test(
      "Shared IP quota commits denial without incrementing PVs and expires correctly",
      async () => {
        await db.query(
          "INSERT INTO portal_private.metric_traffic(key,window_start,attempts) VALUES($1,statement_timestamp(),100) ON CONFLICT(key) DO UPDATE SET attempts=100,window_start=statement_timestamp()",
          [key],
        );
        assert.ok((await collect()) > 0);
        assert.equal(
          (
            await db.query(
              "SELECT sum(page_views)::text AS total FROM portal.daily_metrics WHERE job_id=$1",
              [live],
            )
          ).rows[0].total,
          "2",
        );
        await db.query(
          "UPDATE portal_private.metric_traffic SET window_start=statement_timestamp()-interval '1 minute' WHERE key=$1",
          [key],
        );
        assert.equal(await collect(), 0);
      },
    );
  },
);
