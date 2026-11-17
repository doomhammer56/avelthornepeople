import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
import { expectQueryError } from "../database/helpers.mjs";
loadAuthTestEnvironment();
const { authAdminClient } =
  await import("../../../src/server/adapters/auth/admin.ts");
const { identityClient } =
  await import("../../../src/server/adapters/auth/config.ts");

test(
  "Job commands, snapshot isolation and expiry in the guarded test database",
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
    let user;
    const admin = authAdminClient();
    t.after(async () => {
      await db.query("ROLLBACK").catch(() => {});
      await db.end();
      if (user)
        assert.equal((await admin.auth.admin.deleteUser(user.id)).error, null);
    });
    const email = `be03-${randomUUID()}@example.invalid`;
    const created = await admin.auth.admin.createUser({
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
          "SELECT to_regprocedure('portal_private.manage_job(text,uuid,integer,uuid,jsonb,text,uuid,boolean)') IS NOT NULL AS ready",
        )
      ).rows[0].ready
    )
      await db.query(
        readFileSync(
          "prisma/migrations/20261025000100_job_management/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, "")
          .replace(/COMMIT;\s*$/, ""),
      );
    if (
      !(
        await db.query(
          "SELECT to_regprocedure('portal_private.normalize_job_draft(jsonb)') IS NOT NULL AS ready",
        )
      ).rows[0].ready
    )
      await db.query(
        readFileSync(
          "prisma/migrations/20261025000300_job_editor_validation/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, "")
          .replace(/COMMIT;\s*$/, ""),
      );
    const owner = (await db.query("SELECT current_user AS name")).rows[0].name;
    await db.query(
      `GRANT portal_runtime,portal_jobs_worker,portal_public_reader TO ${pg.escapeIdentifier(owner)}`,
    );
    await db.query(
      "INSERT INTO portal.staff_profiles(id,display_name,role,active) VALUES($1,'BE03 fixture','ADMIN',true)",
      [user.id],
    );
    await db.query(
      "INSERT INTO portal_private.staff_session_admissions(session_id,subject_id,expires_at) VALUES($1,$2,statement_timestamp()+interval '1 hour')",
      [session, user.id],
    );
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [user.id, JSON.stringify({ sub: user.id, session_id: session })],
    );
    const department = (
      await db.query(
        "INSERT INTO portal.departments(code,name_zh,name_en) VALUES($1,'BE03 ZH','BE03') RETURNING id",
        [`BE03_${randomUUID()}`],
      )
    ).rows[0].id;
    const location = (
      await db.query(
        "INSERT INTO portal.locations(code,name_zh,name_en,country_code,timezone) VALUES($1,'BE03 ZH','BE03','RW','Africa/Kigali') RETURNING id",
        [`BE03_${randomUUID()}`],
      )
    ).rows[0].id;
    const draft = {
      en: {
        title: "BE03 support",
        responsibilities: ["Help"],
        requirements: ["Experience"],
      },
      zh: {
        title: "BE03 ZH support",
        responsibilities: ["Help ZH"],
        requirements: ["Experience ZH"],
      },
      settings: {
        departmentId: department,
        locationIds: [location],
        jobType: "FULL_TIME",
        experience: "ANY",
        salary: null,
        showSalary: false,
        publishAt: null,
        closeAt: null,
      },
    };
    const commandSql =
      "SELECT portal_private.manage_job($1,$2::uuid,$3,$4::uuid,$5::jsonb,$6,$7::uuid,$8) AS id";
    const parameters = (
      action,
      id,
      version = null,
      body = null,
      copy = null,
      fallback = false,
    ) => [
      action,
      id,
      version,
      randomUUID(),
      body ? JSON.stringify(body) : null,
      `be03-${id}`,
      copy,
      fallback,
    ];
    async function as(role, action) {
      await db.query("SAVEPOINT command_scope");
      try {
        await db.query(`SET LOCAL ROLE ${role}`);
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
      action,
      id,
      version = null,
      body = null,
      copy = null,
      fallback = false,
    ) =>
      as("portal_runtime", () =>
        db.query(
          commandSql,
          parameters(action, id, version, body, copy, fallback),
        ),
      );
    const reject = (
      action,
      id,
      version,
      code,
      body = null,
      copy = null,
      fallback = false,
    ) =>
      as("portal_runtime", () =>
        expectQueryError(
          db,
          commandSql,
          parameters(action, id, version, body, copy, fallback),
          code,
        ),
      );
    const row = async (id) =>
      (await db.query("SELECT * FROM portal.jobs WHERE id=$1", [id])).rows[0];
    const id = randomUUID();
    await t.test(
      "BE04 bilingual normalization, precision and safe database validation details",
      async () => {
        const editor = randomUUID(),
          value = structuredClone(draft);
        value.zh.title = "　中文职位　";
        value.zh.responsibilities = [
          "　职责一　",
          "",
          "\t",
          "职责  二",
          "职责  二",
        ];
        await call("create", editor, null, value);
        const saved = await row(editor);
        assert.equal(saved.draft_content.zh.title, "中文职位");
        assert.deepEqual(saved.draft_content.zh.responsibilities, [
          "职责一",
          "职责  二",
          "职责  二",
        ]);
        assert.deepEqual(saved.draft_content.en, value.en);
        const invalid = structuredClone(value);
        invalid.settings.salary = {
          min: 0.001,
          max: 1,
          currency: "USD",
          period: "MONTH",
        };
        await as("portal_runtime", async () => {
          await db.query("SAVEPOINT invalid_editor");
          try {
            await assert.rejects(
              db.query(commandSql, parameters("save", editor, 1, invalid)),
              (error) => {
                assert.equal(error.code, "22023");
                assert.deepEqual(JSON.parse(error.detail), [
                  { field: "draft.settings.salary.min", code: "precision" },
                ]);
                return true;
              },
            );
          } finally {
            await db.query("ROLLBACK TO SAVEPOINT invalid_editor");
            await db.query("RELEASE SAVEPOINT invalid_editor");
          }
        });
        assert.equal((await row(editor)).version, 1);
        for (const replacement of [
          { showSalary: "true" },
          { publishAt: "2026-02-30T10:00:00Z" },
          { salary: { min: 0, max: 1, currency: "USD", period: "WEEK" } },
        ])
          await reject("save", editor, 1, "22023", {
            ...value,
            settings: { ...value.settings, ...replacement },
          });
        const blanks = structuredClone(value);
        blanks.zh.title = "　\t　";
        await call("save", editor, 1, blanks);
        await reject("submit", editor, 2, "22023");
        const tooMany = structuredClone(value);
        tooMany.zh.requirements = Array(51).fill("");
        await reject("save", editor, 2, "22023", tooMany);
      },
    );
    await t.test(
      "BE04 approval preserves immediate publication dates and future visibility uses database time",
      async () => {
        const editor = randomUUID();
        await call("create", editor, null, draft);
        await call("submit", editor, 1);
        await call("publish", editor, 2);
        const first = await row(editor);
        assert.ok(first.draft_content.settings.publishAt);
        assert.equal(
          new Date(first.draft_content.settings.publishAt).getTime(),
          first.publish_at.getTime(),
        );
        const edit = structuredClone(first.draft_content);
        edit.en.title = "Updated EN content";
        await call("save", editor, 3, edit);
        await call("publish", editor, 4);
        const revised = await row(editor);
        assert.equal(revised.publish_at.getTime(), first.publish_at.getTime());
        assert.equal(
          revised.first_published_at.getTime(),
          first.first_published_at.getTime(),
        );
        const future = randomUUID(),
          scheduled = structuredClone(draft);
        scheduled.settings.publishAt = "2098-01-01T10:00:00+02:00";
        scheduled.settings.closeAt = "2098-01-02T08:00:00Z";
        await call("create", future, null, scheduled);
        await call("submit", future, 1);
        await call("publish", future, 2);
        await as("portal_public_reader", async () =>
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int n FROM portal.visible_jobs WHERE id=$1",
                [future],
              )
            ).rows[0].n,
            0,
          ),
        );
        await db.query(
          `DO $$ BEGIN UPDATE portal.jobs SET publish_at=statement_timestamp(),close_at=statement_timestamp()+interval '1 day' WHERE id='${future}'::uuid; IF NOT EXISTS(SELECT 1 FROM portal.visible_jobs WHERE id='${future}'::uuid) THEN RAISE EXCEPTION 'Publication boundary missing'; END IF; END $$`,
        );
        // A started translation must be completed or cleared before publication.
        const partial = structuredClone(revised.draft_content);
        partial.en.requirements = [];
        await call("save", editor, 5, partial);
        await reject("publish", editor, 6, "22023");
        await reject("publish", editor, 6, "22023", null, null, true);
        partial.en = { title: "", responsibilities: [], requirements: [] };
        await call("save", editor, 6, partial);
        await call("publish", editor, 7);
        assert.deepEqual((await row(editor)).draft_content.en, partial.en);
        assert.equal(
          (await row(editor)).published_content.englishFallback,
          true,
        );
      },
    );

    await t.test(
      "READ_ONLY, unadmitted sessions and direct writes cannot mutate jobs",
      async () => {
        await db.query(
          "UPDATE portal.staff_profiles SET role='READ_ONLY' WHERE id=$1",
          [user.id],
        );
        await reject("create", id, null, "42501", draft);
        await db.query(
          "UPDATE portal.staff_profiles SET role='HR' WHERE id=$1",
          [user.id],
        );
        await db.query(
          "UPDATE portal_private.staff_session_admissions SET expires_at=statement_timestamp()-interval '1 second' WHERE session_id=$1",
          [session],
        );
        await reject("create", id, null, "42501", draft);
        await db.query(
          "UPDATE portal_private.staff_session_admissions SET expires_at=statement_timestamp()+interval '1 hour' WHERE session_id=$1",
          [session],
        );
        await as("portal_runtime", () =>
          expectQueryError(
            db,
            "INSERT INTO portal.jobs(id,canonical_slug,draft_content,owner_id) VALUES($1,$2,'{}',$3)",
            [id, `be03-${id}`, user.id],
            "42501",
          ),
        );
      },
    );
    await t.test(
      "Create and save have stable identity, version checks and atomic events",
      async () => {
        await call("create", id, null, draft);
        assert.equal((await row(id)).version, 1);
        await reject("create", id, null, "23505", draft);
        await reject("save", id, 2, "40001", draft);
        await call("save", id, 1, draft);
        assert.equal((await row(id)).version, 1);
        await reject("publish", id, 1, "42501");
        await call("submit", id, 1);
        assert.equal((await row(id)).status, "PENDING_REVIEW");
        await reject("publish", id, 2, "42501");
        await db.query(
          "UPDATE portal.staff_profiles SET role='ADMIN' WHERE id=$1",
          [user.id],
        );
        await call("publish", id, 2);
        const saved = await row(id);
        assert.equal(saved.status, "PUBLISHED");
        assert.equal(saved.version, 3);
        const counts = await db.query(
          "SELECT (SELECT count(*) FROM portal.audit_logs WHERE object_id=$1)::int a,(SELECT count(*) FROM portal.outbox_events WHERE aggregate_id=$1)::int e",
          [id],
        );
        assert.deepEqual(counts.rows, [{ a: 3, e: 3 }]);
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal.job_locations WHERE job_id=$1",
              [id],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "Translations stay private until approval and saved settings remain frozen",
      async () => {
        const edited = structuredClone((await row(id)).draft_content);
        edited.zh.title = "Private edit";
        edited.settings.salary = {
          min: 10,
          max: 20,
          currency: "USD",
          period: "MONTH",
        };
        edited.settings.showSalary = true;
        edited.settings.closeAt = "2099-01-01T00:00:00.000Z";
        await reject("save", id, 3, "22023", edited);
        edited.settings = (await row(id)).draft_content.settings;
        await call("save", id, 3, edited);
        let saved = await row(id);
        assert.equal(saved.published_content.zh.title, draft.zh.title);
        assert.equal(saved.salary_min, null);
        assert.equal(saved.close_at, null);
        await call("submit", id, 4);
        assert.equal((await row(id)).status, "PUBLISHED");
        assert.equal((await row(id)).version, 4);
        await call("publish", id, 4);
        saved = await row(id);
        assert.equal(saved.published_content.zh.title, "Private edit");
        assert.equal(saved.salary_min, null);
        assert.equal(saved.close_at, null);
        await call("publish", id, 5);
        assert.equal((await row(id)).version, 5);
        await as("portal_public_reader", async () =>
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int n FROM portal.visible_jobs WHERE id=$1",
                [id],
              )
            ).rows[0].n,
            1,
          ),
        );
      },
    );
    await t.test(
      "Pause, resume, close and duplicate enforce role and lifecycle boundaries",
      async () => {
        await db.query(
          "UPDATE portal.staff_profiles SET role='HR' WHERE id=$1",
          [user.id],
        );
        await call("pause", id, 5);
        await reject("resume", id, 6, "42501");
        await db.query(
          "UPDATE portal.staff_profiles SET role='ADMIN' WHERE id=$1",
          [user.id],
        );
        await call("resume", id, 6);
        await call("close", id, 7);
        await reject("save", id, 8, "55000", draft);
        await reject("resume", id, 8, "55000");
        const copy = randomUUID();
        await call("duplicate", id, 8, null, copy);
        const saved = await row(copy);
        assert.equal(saved.status, "DRAFT");
        assert.equal(saved.version, 1);
        assert.equal(saved.published_content, null);
        assert.equal(saved.approved_at, null);
        assert.equal(saved.first_published_at, null);
        assert.equal(saved.draft_content.settings.closeAt, null);
      },
    );
    await t.test(
      "Chinese-only publication succeeds and invalid references fail safely",
      async () => {
        const other = randomUUID(),
          chinese = structuredClone(draft);
        chinese.en = { title: "", responsibilities: [], requirements: [] };
        await call("create", other, null, chinese);
        await call("submit", other, 1);
        await call("publish", other, 2);
        assert.equal(
          (await row(other)).published_content.englishFallback,
          true,
        );
        const invalid = structuredClone(draft);
        invalid.settings.departmentId = randomUUID();
        await reject("save", other, 3, "22023", invalid);
        await reject("save", other, 3, "22023", {
          ...draft,
          settings: { ...draft.settings, showSalary: true },
        });
      },
    );
    await t.test(
      "Audit/outbox failures roll back the job transition",
      async () => {
        const other = randomUUID();
        await call("create", other, null, draft);
        await db.query(
          "INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key) VALUES('TEST',$1,$2)",
          [other, `job:${other}:2`],
        );
        await reject("submit", other, 1, "23505");
        assert.equal((await row(other)).status, "DRAFT");
        assert.equal((await row(other)).version, 1);
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal.audit_logs WHERE object_id=$1",
              [other],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "Older postings preserve metadata when duplicated after the backfill",
      async () => {
        const legacy = randomUUID(),
          copy = randomUUID();
        const content = { en: draft.en, zh: draft.zh };
        await db.query(
          `INSERT INTO portal.jobs(id,canonical_slug,draft_content,published_content,status,published_version,owner_id,approved_by,approved_at,department_id,job_type,experience,publish_at)
        VALUES($1,$2,$3::jsonb,$3::jsonb,'PUBLISHED',1,$4,$4,statement_timestamp(),$5,'FULL_TIME','ANY',statement_timestamp())`,
          [
            legacy,
            `be03-${legacy}`,
            JSON.stringify(content),
            user.id,
            department,
          ],
        );
        await db.query(
          "INSERT INTO portal.job_locations(job_id,location_id) VALUES($1,$2)",
          [legacy, location],
        );
        await db.query(
          readFileSync(
            "prisma/migrations/20261025000200_job_draft_settings/migration.sql",
            "utf8",
          )
            .replace(/^BEGIN;/, "")
            .replace(/COMMIT;\s*$/, ""),
        );
        await call("duplicate", legacy, 1, null, copy);
        const saved = await row(copy);
        assert.equal(saved.draft_content.settings.departmentId, department);
        assert.deepEqual(saved.draft_content.settings.locationIds, [location]);
        assert.equal(saved.draft_content.settings.publishAt, null);
        assert.equal(saved.published_content, null);
        assert.equal((await row(legacy)).version, 1);
      },
    );
    await t.test(
      "Expiry uses the DB clock, ignores ineligible rows and is repeatable with one event per closure",
      async () => {
        const ids = Array.from({ length: 6 }, () => randomUUID());
        for (const jobId of ids) {
          await call("create", jobId, null, draft);
          await call("submit", jobId, 1);
          await call("publish", jobId, 2);
        }
        await db.query(
          "UPDATE portal.jobs SET publish_at=statement_timestamp()-interval '2 days',close_at=statement_timestamp()-interval '1 second' WHERE id=ANY($1::uuid[])",
          [ids.slice(0, 4)],
        );
        await db.query("UPDATE portal.jobs SET status='PAUSED' WHERE id=$1", [
          ids[1],
        ]);
        await db.query("UPDATE portal.jobs SET status='DRAFT' WHERE id=$1", [
          ids[2],
        ]);
        await db.query(
          "UPDATE portal.jobs SET status='PENDING_REVIEW' WHERE id=$1",
          [ids[3]],
        );
        await db.query(
          "UPDATE portal.jobs SET close_at=statement_timestamp()+interval '1 day' WHERE id=$1",
          [ids[4]],
        );
        // Expired listings disappear even before Cron records their CLOSED state.
        await as("portal_public_reader", async () =>
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int n FROM portal.visible_jobs WHERE id=ANY($1::uuid[])",
                [ids],
              )
            ).rows[0].n,
            2,
          ),
        );
        await as("portal_runtime", () =>
          expectQueryError(
            db,
            "SELECT * FROM portal_private.close_expired_jobs(100,$1)",
            [randomUUID()],
            "42501",
          ),
        );
        await as("portal_jobs_worker", () =>
          expectQueryError(db, "SELECT * FROM portal.jobs", [], "42501"),
        );
        await as("portal_jobs_worker", () =>
          db.query("SELECT * FROM portal_private.close_expired_jobs(100,$1)", [
            randomUUID(),
          ]),
        );
        await as("portal_jobs_worker", () =>
          db.query("SELECT * FROM portal_private.close_expired_jobs(100,$1)", [
            randomUUID(),
          ]),
        );
        assert.equal((await row(ids[0])).status, "CLOSED");
        assert.equal((await row(ids[1])).status, "CLOSED");
        assert.equal((await row(ids[2])).status, "DRAFT");
        assert.equal((await row(ids[3])).status, "PENDING_REVIEW");
        assert.equal((await row(ids[4])).status, "PUBLISHED");
        assert.equal((await row(ids[5])).status, "PUBLISHED");
        for (const jobId of ids.slice(0, 2))
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int n FROM portal.audit_logs WHERE object_id=$1 AND safe_changes->>'reason'='EXPIRED' AND actor_id IS NULL",
                [jobId],
              )
            ).rows[0].n,
            1,
          );
        // Exact boundary in one statement: close_at equals the worker's statement_timestamp().
        const boundary = randomUUID();
        await call("create", boundary, null, draft);
        await call("submit", boundary, 1);
        await call("publish", boundary, 2);
        await db.query(
          `DO $$ BEGIN UPDATE portal.jobs SET publish_at=statement_timestamp()-interval '1 day',close_at=statement_timestamp() WHERE id='${boundary}'::uuid; PERFORM portal_private.close_expired_jobs(100,'${randomUUID()}'::uuid); END $$`,
        );
        assert.equal((await row(boundary)).status, "CLOSED");
      },
    );
  },
);
