import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("settings-lock migration works without superuser and revokes temporary schema privileges", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE migration_runner LOGIN NOSUPERUSER INHERIT CREATEROLE;
      CREATE ROLE portal_jobs_owner NOLOGIN NOINHERIT NOSUPERUSER;
      GRANT portal_jobs_owner TO migration_runner WITH ADMIN OPTION;
      CREATE SCHEMA portal AUTHORIZATION migration_runner;
      CREATE SCHEMA portal_private AUTHORIZATION migration_runner;
      CREATE TABLE portal.jobs(
        id uuid,canonical_slug text,draft_content jsonb,owner_id uuid,version integer,status text,published_version integer,
        published_content jsonb,department_id uuid,job_type text,experience text,salary_min numeric,salary_max numeric,
        salary_currency text,salary_period text,show_salary boolean,publish_at timestamptz,close_at timestamptz,
        approved_by uuid,approved_at timestamptz,first_published_at timestamptz
      );
      ALTER TABLE portal.jobs OWNER TO migration_runner;
      GRANT USAGE ON SCHEMA portal,portal_private TO portal_jobs_owner;
      INSERT INTO portal.jobs(canonical_slug,draft_content) VALUES
        ('complete','{"settings":{"departmentId":"department","locationIds":["location"],"jobType":"FULL_TIME","experience":"ANY"}}'),
        ('unfinished','{"settings":{"departmentId":null,"locationIds":[],"jobType":"FULL_TIME","experience":"ANY"}}');
      SET ROLE migration_runner;
    `);
    assert.equal(
      (
        await db.query(
          "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0].rolsuper,
      false,
    );
    const migration = readFileSync(
      "prisma/migrations/20261029000100_job_settings_lock/migration.sql",
      "utf8",
    );
    await db.exec(migration);
    await db.exec(
      readFileSync(
        "prisma/migrations/20261029000200_job_settings_lock_validation/migration.sql",
        "utf8",
      ),
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT canonical_slug,settings_locked FROM portal.jobs ORDER BY canonical_slug",
        )
      ).rows,
      [
        { canonical_slug: "complete", settings_locked: true },
        { canonical_slug: "unfinished", settings_locked: false },
      ],
    );
    const privileges = (
      await db.query(`SELECT
      has_schema_privilege('portal_jobs_owner','portal_private','CREATE') can_create,
      has_schema_privilege('portal_jobs_owner','portal_private','USAGE') can_use,
      has_function_privilege('portal_jobs_owner','portal_private.job_settings_complete(jsonb)','EXECUTE') can_execute,
      EXISTS(SELECT 1 FROM pg_auth_members m
        WHERE m.roleid='portal_jobs_owner'::regrole AND m.member=current_user::regrole
          AND m.grantor=current_user::regrole) temporary_grant
    `)
    ).rows[0];
    assert.deepEqual(privileges, {
      can_create: false,
      can_use: true,
      can_execute: true,
      temporary_grant: false,
    });
    assert.equal(
      (
        await db.query(`SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
      WHERE p.oid='portal_private.job_settings_complete(jsonb)'::regprocedure`)
      ).rows[0].rolname,
      "portal_jobs_owner",
    );
  } finally {
    await db.exec("ROLLBACK");
    await db.close();
  }
});
