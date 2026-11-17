import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
import { verifiedDatabaseConfig } from "../../../src/server/database/tls.ts";

loadAuthTestEnvironment();
test(
  "privacy migration applies on guarded hosted PostgreSQL and rolls back all schema/data changes",
  { timeout: 60000 },
  async () => {
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client(
          verifiedDatabaseConfig({
            connectionString: process.env.DIRECT_URL,
            connectionTimeoutMillis: 15000,
            statement_timeout: 15000,
          }),
        ),
    );
    try {
      const before = (
        await db.query(
          "SELECT to_regclass('portal.privacy_policy')::text existing",
        )
      ).rows[0].existing;
      assert.equal(
        before,
        null,
        "Use an unmigrated QA project for the rollback migration test",
      );
      await db.query("BEGIN; SET LOCAL lock_timeout='2s'");
      const sql = readFileSync(
        "prisma/migrations/20261031000100_privacy_retention/migration.sql",
        "utf8",
      )
        .replace(/^BEGIN;/, "")
        .replace(/COMMIT;\s*$/, "");
      await db.query(sql);
      await db.query(
        readFileSync(
          "prisma/migrations/20261102000100_privacy_dependency_permissions/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, "")
          .replace(/COMMIT;\s*$/, ""),
      );
      const {
        rows: [checks],
      } = await db.query(`SELECT
      (SELECT retention_months=24 AND NOT retention_enabled FROM portal.privacy_policy WHERE id=1) safe_defaults,
      NOT has_function_privilege('portal_runtime','portal_private.prepare_privacy_cleanup(integer)','EXECUTE') runtime_cannot_erase,
      has_function_privilege('portal_privacy_worker','portal_private.prepare_privacy_cleanup(integer)','EXECUTE') worker_can_prepare,
      NOT has_table_privilege('portal_privacy_worker','portal.candidates','SELECT') worker_cannot_read_profiles,
      NOT has_function_privilege('anon','portal_private.manage_privacy(text,uuid,integer,uuid,jsonb)','EXECUTE') anon_denied,
      has_function_privilege('portal_privacy_owner','portal_private.candidate_group_blocked(uuid)','EXECUTE') privacy_can_check_candidate_group,
      strpos(pg_get_functiondef('portal_private.record_cv_access(uuid,uuid)'::regprocedure),'application_data_available')>0 cv_expiry_guard,
      has_function_privilege((SELECT proowner FROM pg_proc WHERE oid='portal_private.record_cv_access(uuid,uuid)'::regprocedure),
        'portal_private.application_data_available(uuid,timestamptz,timestamptz)','EXECUTE') cv_owner_can_check_expiry,
      strpos(pg_get_functiondef('portal_private.replay_application(uuid,bytea,uuid,uuid,bytea)'::regprocedure),'application_data_available')>0 replay_expiry_guard`);
      assert.ok(Object.values(checks).every(Boolean), JSON.stringify(checks));
      await db.query("ROLLBACK");
      assert.equal(
        (
          await db.query(
            "SELECT to_regclass('portal.privacy_policy')::text existing",
          )
        ).rows[0].existing,
        null,
      );
      assert.equal(
        (
          await db.query(
            "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='portal_privacy_worker') present",
          )
        ).rows[0].present,
        false,
      );
    } finally {
      await db.query("ROLLBACK").catch(() => {});
      await db.end();
    }
  },
);
