import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { jobPublicationIssues } from "../../../src/lib/admin/jobValidation.ts";
import { adminJobDto } from "../../../src/server/admin/dto.ts";
import { databaseJobError } from "../../../src/server/jobs/validation.ts";

function functionSql(source, name) {
  const sql = source.match(
    new RegExp(
      `CREATE (?:OR REPLACE )?FUNCTION portal_private\\.${name}\\([\\s\\S]*?\\$\\$;`,
    ),
  )?.[0];
  assert.ok(sql, name);
  return sql;
}

test("job settings locks preserve translations, publication, validation and versions", async (t) => {
  const db = new PGlite();
  const actor = randomUUID(),
    department = randomUUID(),
    location = randomUUID();
  const blank = () => ({ title: "", responsibilities: [], requirements: [] });
  const content = () => ({
    title: "Engineer",
    responsibilities: ["Build"],
    requirements: ["Experience"],
  });
  const draft = (en = content(), zh = blank()) => ({
    en,
    zh,
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
  });
  try {
    await db.exec(`CREATE SCHEMA portal; CREATE SCHEMA portal_private;
      CREATE ROLE portal_jobs_owner NOLOGIN;
      CREATE TABLE portal.staff_profiles(id uuid PRIMARY KEY,role text,active boolean);
      CREATE TABLE portal.departments(id uuid PRIMARY KEY,active boolean,name_en text);
      CREATE TABLE portal.locations(id uuid PRIMARY KEY,active boolean,name_en text);
      CREATE TABLE portal.job_options(id uuid DEFAULT gen_random_uuid(),kind text,code text,active boolean);
      CREATE TABLE portal.jobs(id uuid PRIMARY KEY,canonical_slug text UNIQUE,draft_content jsonb,published_content jsonb,
        owner_id uuid,version integer DEFAULT 1,status text DEFAULT 'DRAFT',published_version integer,
        department_id uuid,job_type text,experience text,salary_min numeric,salary_max numeric,salary_currency text,
        salary_period text,show_salary boolean,publish_at timestamptz,close_at timestamptz,approved_by uuid,
        approved_at timestamptz,first_published_at timestamptz);
      CREATE TABLE portal.job_locations(job_id uuid,location_id uuid);
      CREATE FUNCTION portal_private.staff_session_is_admitted(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE FUNCTION portal_private.job_event(uuid,integer,text,uuid,uuid,text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
      INSERT INTO portal.job_options(kind,code,active) VALUES('jobType','FULL_TIME',true),('experience','ANY',true);`);
    await db.query(
      "INSERT INTO portal.staff_profiles VALUES($1,'ADMIN',true);",
      [actor],
    );
    await db.query(
      "INSERT INTO portal.departments VALUES($1,true,'Engineering')",
      [department],
    );
    await db.query("INSERT INTO portal.locations VALUES($1,true,'Kigali')", [
      location,
    ]);
    const oldValidation = readFileSync(
      "prisma/migrations/20261025000300_job_editor_validation/migration.sql",
      "utf8",
    );
    const references = readFileSync(
      "prisma/migrations/20261026000500_job_reference_management/migration.sql",
      "utf8",
    );
    for (const name of ["job_invalid", "job_trim"])
      await db.exec(functionSql(oldValidation, name));
    await db.exec(functionSql(references, "normalize_job_draft"));
    await db.exec(
      readFileSync(
        "prisma/migrations/20261028000300_job_optional_translations/migration.sql",
        "utf8",
      ),
    );
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [actor, JSON.stringify({ session_id: randomUUID() })],
    );

    async function command(
      action,
      id,
      version,
      value = null,
      fallback = false,
      copy = null,
      slug = `job-${id}`,
    ) {
      return db.query(
        "SELECT portal_private.manage_job($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          action,
          id,
          version,
          randomUUID(),
          value ? JSON.stringify(value) : null,
          slug,
          copy,
          fallback,
        ],
      );
    }
    const row = async (id) =>
      (await db.query("SELECT * FROM portal.jobs WHERE id=$1", [id])).rows[0];
    const legacyComplete = randomUUID(),
      legacyIncomplete = randomUUID();
    const incomplete = draft();
    incomplete.settings.departmentId = null;
    incomplete.settings.locationIds = [];
    await command("create", legacyComplete, null, draft());
    await command("create", legacyIncomplete, null, incomplete);
    await db.exec(
      readFileSync(
        "prisma/migrations/20261029000100_job_settings_lock/migration.sql",
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        "prisma/migrations/20261029000200_job_settings_lock_validation/migration.sql",
        "utf8",
      ),
    );

    await t.test(
      "expired schedules are rejected before complete settings are frozen",
      async () => {
        const id = randomUUID(),
          expired = draft();
        expired.settings.closeAt = "2000-01-01T00:00:00.000Z";
        await assert.rejects(command("create", id, null, expired), (error) => {
          assert.deepEqual(databaseJobError(error).issues, [
            { field: "draft.settings.closeAt", code: "expired" },
          ]);
          return true;
        });
        assert.equal(await row(id), undefined);
        const unfinished = structuredClone(incomplete);
        unfinished.settings.closeAt = expired.settings.closeAt;
        await command("create", id, null, unfinished);
        await assert.rejects(command("save", id, 1, expired), (error) => {
          assert.deepEqual(databaseJobError(error).issues, [
            { field: "draft.settings.closeAt", code: "expired" },
          ]);
          return true;
        });
        assert.equal((await row(id)).settings_locked, false);
        assert.equal((await row(id)).version, 1);
        const corrected = structuredClone(expired);
        corrected.settings.closeAt = "2099-01-01T00:00:00.000Z";
        await command("save", id, 1, corrected);
        assert.equal((await row(id)).settings_locked, true);
      },
    );

    await t.test(
      "deactivated saved references permit translation drafts and still prevent publication",
      async () => {
        const id = randomUUID();
        await command("create", id, null, draft());
        let version = 1;
        for (const [disable, enable, field] of [
          [
            "UPDATE portal.departments SET active=false",
            "UPDATE portal.departments SET active=true",
            "departmentId",
          ],
          [
            "UPDATE portal.locations SET active=false",
            "UPDATE portal.locations SET active=true",
            "locationIds",
          ],
          [
            "UPDATE portal.job_options SET active=false WHERE kind='jobType'",
            "UPDATE portal.job_options SET active=true WHERE kind='jobType'",
            "jobType",
          ],
          [
            "UPDATE portal.job_options SET active=false WHERE kind='experience'",
            "UPDATE portal.job_options SET active=true WHERE kind='experience'",
            "experience",
          ],
        ]) {
          await db.exec(disable);
          try {
            const translated = (await row(id)).draft_content;
            translated.en.title = `English translation ${field}`;
            translated.zh = {
              ...content(),
              title: `Chinese translation ${field}`,
            };
            const originalSettings = structuredClone(translated.settings);
            await command("save", id, version++, translated);
            assert.deepEqual(
              (await row(id)).draft_content.settings,
              originalSettings,
            );
            await assert.rejects(command("submit", id, version), (error) => {
              assert.deepEqual(databaseJobError(error).issues, [
                { field: `draft.settings.${field}`, code: "inactive" },
              ]);
              return true;
            });
            translated.settings.locationIds = [];
            await assert.rejects(
              command("save", id, version, translated),
              (error) => {
                assert.deepEqual(databaseJobError(error).issues, [
                  { field: "draft.settings.locationIds", code: "locked" },
                ]);
                return true;
              },
            );
          } finally {
            await db.exec(enable);
          }
        }
        await command("submit", id, version++);
        await command("publish", id, version);
      },
    );

    await t.test(
      "existing complete settings lock; unfinished drafts can be completed and then lock",
      async () => {
        assert.equal((await row(legacyComplete)).settings_locked, true);
        assert.equal((await row(legacyIncomplete)).settings_locked, false);
        const stillIncomplete = structuredClone(incomplete);
        stillIncomplete.en.title = "Unfinished draft";
        await command("save", legacyIncomplete, 1, stillIncomplete);
        assert.equal((await row(legacyIncomplete)).settings_locked, false);
        await command("save", legacyIncomplete, 2, draft());
        assert.equal((await row(legacyIncomplete)).settings_locked, true);
        const fresh = randomUUID();
        await command("create", fresh, null, incomplete);
        assert.equal((await row(fresh)).settings_locked, false);
      },
    );

    await t.test(
      "all saved Page 2 fields reject current-version updates atomically",
      async () => {
        const id = randomUUID(),
          initial = draft();
        initial.settings.salary = {
          min: 0,
          max: 10,
          currency: "USD",
          period: "MONTH",
        };
        initial.settings.publishAt = "2098-01-01T08:00:00.000Z";
        initial.settings.closeAt = "2098-01-02T08:00:00.000Z";
        await command("create", id, null, initial);
        const stored = await row(id);
        assert.equal(stored.settings_locked, true);
        assert.equal(
          adminJobDto({ ...stored, created_at: new Date() }).settingsLocked,
          true,
        );
        for (const [field, value] of Object.entries({
          departmentId: randomUUID(),
          locationIds: [],
          jobType: "INTERNSHIP",
          experience: "MID",
          salary: { ...initial.settings.salary, max: 20 },
          showSalary: true,
          publishAt: "2098-01-01T09:00:00.000Z",
          closeAt: "2098-01-03T08:00:00.000Z",
        })) {
          const changed = structuredClone(initial);
          changed.zh = content();
          changed.settings[field] = value;
          await assert.rejects(command("save", id, 1, changed), (error) => {
            assert.equal(error.code, "22023");
            assert.deepEqual(databaseJobError(error).issues, [
              { field: `draft.settings.${field}`, code: "locked" },
            ]);
            return true;
          });
          assert.deepEqual(await row(id), stored);
        }
        await assert.rejects(
          command("save", id, 1, initial, false, null, "changed-slug"),
          (error) => {
            assert.deepEqual(databaseJobError(error).issues, [
              { field: "slug", code: "locked" },
            ]);
            return true;
          },
        );
        // Equivalent instants from older clients do not count as schedule edits.
        const equivalent = structuredClone(initial);
        equivalent.settings.publishAt = "2098-01-01T10:00:00+02:00";
        await command("save", id, 1, equivalent);
        assert.equal((await row(id)).version, 1);
        for (const [version, language] of [
          [1, "en"],
          [2, "zh"],
        ]) {
          const translated = (await row(id)).draft_content;
          translated[language] = {
            ...content(),
            title: `${language} translation`,
          };
          await command("save", id, version, translated);
          const saved = await row(id);
          assert.equal(saved.version, version + 1);
          assert.deepEqual(
            saved.draft_content.settings,
            stored.draft_content.settings,
          );
          assert.equal(saved.settings_locked, true);
        }
        await assert.rejects(command("save", id, 1, initial), {
          code: "40001",
        });
      },
    );

    await t.test(
      "duplicated jobs can be configured once, including an unchanged first save",
      async () => {
        const copy = randomUUID();
        await command("duplicate", legacyComplete, 1, null, false, copy);
        assert.equal((await row(copy)).settings_locked, false);
        await command("save", copy, 1, draft());
        assert.equal((await row(copy)).settings_locked, true);
        assert.equal((await row(copy)).version, 2);
        const editableCopy = randomUUID();
        await command(
          "duplicate",
          legacyComplete,
          1,
          null,
          false,
          editableCopy,
        );
        const configured = draft();
        configured.settings.salary = {
          min: 1,
          max: 2,
          currency: "USD",
          period: "MONTH",
        };
        await command("save", editableCopy, 1, configured);
        assert.deepEqual(
          (await row(editableCopy)).draft_content.settings.salary,
          configured.settings.salary,
        );
        assert.equal((await row(editableCopy)).settings_locked, true);
        const submittedCopy = randomUUID();
        await command(
          "duplicate",
          legacyComplete,
          1,
          null,
          false,
          submittedCopy,
        );
        await command("submit", submittedCopy, 1);
        assert.equal((await row(submittedCopy)).settings_locked, true);
        await command("publish", submittedCopy, 2);
        assert.equal((await row(submittedCopy)).settings_locked, true);
      },
    );
    for (const [en, zh, expectedFallback] of [
      [content(), blank(), false],
      [blank(), content(), true],
      [content(), content(), false],
    ]) {
      const id = randomUUID();
      await command("create", id, null, draft(en, zh));
      await command("submit", id, 1);
      await command("publish", id, 2);
      const {
        rows: [job],
      } = await db.query("SELECT * FROM portal.jobs WHERE id=$1", [id]);
      assert.equal(job.status, "PUBLISHED");
      assert.equal(job.version, 3);
      assert.equal(job.settings_locked, true);
      assert.equal(job.published_content.englishFallback, expectedFallback);
      assert.equal(job.published_content.en.title, en.title);
      assert.equal(job.published_content.zh.title, zh.title);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM portal.job_locations WHERE job_id=$1",
            [id],
          )
        ).rows[0].n,
        1,
      );
      await assert.rejects(command("save", id, 1, draft(en, zh)), {
        code: "40001",
      });
      const translated = structuredClone(job.draft_content);
      const language = en.title ? "en" : "zh";
      translated[language].title = "Updated translation";
      await command("save", id, 3, translated);
      await command("publish", id, 4);
      assert.deepEqual(
        (await row(id)).draft_content.settings,
        job.draft_content.settings,
      );
      await command("pause", id, 5);
      await command("resume", id, 6);
      await command("close", id, 7);
      await assert.rejects(command("save", id, 8, translated), {
        code: "55000",
      });
    }
    for (const value of [
      draft(blank(), blank()),
      draft(content(), { ...blank(), title: "Partial" }),
      { ...draft(), settings: { ...draft().settings, departmentId: null } },
    ]) {
      const expected = jobPublicationIssues(value)[0];
      await assert.rejects(
        db.query("SELECT portal_private.validate_job_draft($1,true,false)", [
          JSON.stringify(value),
        ]),
        (error) => {
          assert.equal(error.code, "22023");
          assert.deepEqual(JSON.parse(error.detail), [expected]);
          return true;
        },
      );
      await db.query(
        "SELECT portal_private.validate_job_draft($1,false,false)",
        [JSON.stringify(value)],
      );
    }
    const hrJob = randomUUID();
    await command("create", hrJob, null, draft());
    await command("submit", hrJob, 1);
    await db.query("UPDATE portal.staff_profiles SET role='HR' WHERE id=$1", [
      actor,
    ]);
    await assert.rejects(command("publish", hrJob, 2), { code: "42501" });
  } finally {
    await db.close();
  }
});
