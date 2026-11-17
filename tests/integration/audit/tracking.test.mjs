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
import {
  safePayloads,
  unsafePayloads,
} from "../../fixtures/audit-payloads.mjs";
import {
  knownActions,
  knownTypes,
} from "../../../src/server/audit/contract.ts";
loadAuthTestEnvironment();
const { createStaffSession } = await import("../../helpers/staff-session.mjs");

test(
  "Administrative audit privacy, triggers and write boundaries",
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
    const users = [];
    t.after(async () => {
      await db.query("ROLLBACK").catch(() => {});
      await db.end();
      for (const u of users) await u.remove();
    });
    await db.query("BEGIN");
    if (
      !(
        await db.query(
          "SELECT to_regprocedure('portal_private.audit_payload_is_safe(jsonb)') IS NOT NULL ready",
        )
      ).rows[0].ready
    )
      await db.query(
        readFileSync(
          "prisma/migrations/20261026000100_administrative_audit/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, "")
          .replace(/COMMIT;\s*$/, ""),
      );
    if (
      !(
        await db.query(
          "SELECT to_regprocedure('portal_private.audit_codes_are_safe(text,text)') IS NOT NULL ready",
        )
      ).rows[0].ready
    )
      await db.query(
        readFileSync(
          "prisma/migrations/20261026000200_audit_code_allowlist/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, "")
          .replace(/COMMIT;\s*$/, ""),
      );
    users.push(await createStaffSession(db, "ADMIN"));
    const admin = users[0];
    await db.query("GRANT portal_runtime TO CURRENT_USER");
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [
        admin.id,
        JSON.stringify({ sub: admin.id, session_id: admin.sessionId }),
      ],
    );
    async function runtime(fn) {
      await db.query("SAVEPOINT runtime_scope");
      await db.query("SET LOCAL ROLE portal_runtime");
      try {
        const result = await fn();
        await db.query("RESET ROLE");
        await db.query("RELEASE SAVEPOINT runtime_scope");
        return result;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT runtime_scope");
        await db.query("RELEASE SAVEPOINT runtime_scope");
        throw error;
      }
    }
    const insert = (payload) =>
      db.query(
        "INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id) VALUES($1,'JOB',$2,'JOB_SAVE',$3::jsonb,$4)",
        [admin.id, randomUUID(), JSON.stringify(payload), randomUUID()],
      );
    await t.test(
      "SQL and TypeScript payload contracts accept existing writers and reject PII canaries",
      async () => {
        for (const value of safePayloads) {
          assert.equal(
            (
              await db.query(
                "SELECT portal_private.audit_payload_is_safe($1::jsonb) safe",
                [JSON.stringify(value)],
              )
            ).rows[0].safe,
            true,
          );
          await insert(value);
        }
        for (const value of unsafePayloads) {
          assert.equal(
            (
              await db.query(
                "SELECT portal_private.audit_payload_is_safe($1::jsonb) safe",
                [JSON.stringify(value)],
              )
            ).rows[0].safe,
            false,
          );
          await expectQueryError(
            db,
            "INSERT INTO portal.audit_logs(object_type,object_id,action,safe_changes,request_id) VALUES('JOB',$1,'JOB_SAVE',$2::jsonb,$3)",
            [randomUUID(), JSON.stringify(value), randomUUID()],
            "23514",
          );
        }
      },
    );
    await t.test(
      "SQL code catalogue matches the safe projection and rejects uppercase private codes",
      async () => {
        assert.equal(
          (
            await db.query(
              "SELECT bool_and(portal_private.audit_codes_are_safe('JOB',code)) safe FROM unnest($1::text[]) code",
              [knownActions.options],
            )
          ).rows[0].safe,
          true,
        );
        assert.equal(
          (
            await db.query(
              "SELECT bool_and(portal_private.audit_codes_are_safe(code,'JOB_SAVE')) safe FROM unnest($1::text[]) code",
              [knownTypes.options],
            )
          ).rows[0].safe,
          true,
        );
        for (const [kind, action] of [
          ["JOB", "PRIVATE_CANDIDATE_CANARY"],
          ["PRIVATE_PERSON_CANARY", "JOB_SAVE"],
        ])
          await expectQueryError(
            db,
            "INSERT INTO portal.audit_logs(object_type,object_id,action,request_id) VALUES($1,$2,$3,$4)",
            [kind, randomUUID(), action, randomUUID()],
            "23514",
          );
      },
    );
    await t.test(
      "rejected audit payloads are not echoed in database error diagnostics",
      async () => {
        await db.query("SAVEPOINT unsafe_diagnostics");
        try {
          await assert.rejects(
            insert({ email: "audit-canary@example.invalid" }),
            (error) =>
              error.code === "23514" &&
              error.message === "Unsafe audit record" &&
              error.detail === undefined,
          );
        } finally {
          await db.query("ROLLBACK TO SAVEPOINT unsafe_diagnostics");
          await db.query("RELEASE SAVEPOINT unsafe_diagnostics");
        }
      },
    );
    let department;
    await t.test(
      "admitted lookup writes log field names, skip no-ops and commit with outbox",
      async () => {
        department = (
          await runtime(() =>
            db.query(
              "INSERT INTO portal.departments(id,code,name_zh,name_en) VALUES(gen_random_uuid(),$1,'Audit fixture','Private Name Canary') RETURNING id",
              [`audit-${randomUUID()}`],
            ),
          )
        ).rows[0].id;
        await runtime(() =>
          db.query(
            "UPDATE portal.departments SET name_en='private@example.invalid' WHERE id=$1",
            [department],
          ),
        );
        await runtime(() =>
          db.query(
            "UPDATE portal.departments SET name_en=name_en WHERE id=$1",
            [department],
          ),
        );
        const records = (
          await db.query(
            "SELECT action,safe_changes,request_id FROM portal.audit_logs WHERE object_id=$1 ORDER BY action",
            [department],
          )
        ).rows;
        assert.deepEqual(
          records.map((r) => r.action),
          ["DEPARTMENT_CREATED", "DEPARTMENT_UPDATED"],
        );
        assert.deepEqual(records[1].safe_changes, { fields: ["name_en"] });
        assert.ok(!JSON.stringify(records).includes("private@example.invalid"));
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal.outbox_events WHERE aggregate_id=$1",
              [department],
            )
          ).rows[0].n,
          2,
        );
      },
    );
    await t.test(
      "audit failure rolls back the admitted domain change",
      async () => {
        await db.query("SAVEPOINT audit_failure");
        try {
          await db.query(
            "REVOKE INSERT ON portal.audit_logs FROM portal_audit_owner",
          );
          await expectQueryError(
            db,
            "UPDATE portal.departments SET active=false WHERE id=$1",
            [department],
            "42501",
          );
          assert.equal(
            (
              await db.query(
                "SELECT active FROM portal.departments WHERE id=$1",
                [department],
              )
            ).rows[0].active,
            true,
          );
        } finally {
          await db.query("ROLLBACK TO SAVEPOINT audit_failure");
          await db.query("RELEASE SAVEPOINT audit_failure");
        }
      },
    );
    await t.test(
      "contact assignment/state changes exclude sender and message content",
      async () => {
        const id = (
          await db.query(
            "INSERT INTO portal.contact_messages(sender_encrypted,body_encrypted,locale) VALUES($1,$1,'en') RETURNING id",
            [randomBytes(48)],
          )
        ).rows[0].id;
        await runtime(() =>
          db.query(
            "UPDATE portal.contact_messages SET state='IN_PROGRESS',assigned_to=$2 WHERE id=$1",
            [id, admin.id],
          ),
        );
        const change = (
          await db.query(
            "SELECT safe_changes FROM portal.audit_logs WHERE object_id=$1 AND action='CONTACT_MESSAGE_UPDATED'",
            [id],
          )
        ).rows[0].safe_changes;
        assert.deepEqual(change, { fields: ["state", "assigned_to"] });
      },
    );
    await t.test(
      "provider reconciliation records the first committed completion only",
      async () => {
        const target = await createStaffSession(db, "HR");
        users.push(target);
        const operation = randomUUID();
        await db.query(
          "UPDATE portal.staff_profiles SET active=false WHERE id=$1",
          [target.id],
        );
        await db.query(
          "INSERT INTO portal_private.staff_provider_operations(id,profile_id,operation) VALUES($1,$2,'ban')",
          [operation, target.id],
        );
        const claimId = randomUUID();
        await runtime(() =>
          db.query(
            "SELECT * FROM portal_private.claim_staff_provider_operation($1,$2)",
            [operation, claimId],
          ),
        );
        await runtime(() =>
          db.query(
            "SELECT portal_private.finish_staff_provider_claim($1,$2,true)",
            [operation, claimId],
          ),
        );
        await runtime(() =>
          db.query(
            "SELECT portal_private.finish_staff_provider_claim($1,$2,true)",
            [operation, claimId],
          ),
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal.audit_logs WHERE request_id=$1 AND action='STAFF_PROVIDER_SYNCED'",
              [operation],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "runtime cannot forge or modify audit rows and HR cannot inspect them",
      async () => {
        await runtime(async () => {
          for (const sql of [
            "INSERT INTO portal.audit_logs(object_type,object_id,action,request_id) VALUES('JOB',gen_random_uuid(),'FAKE',gen_random_uuid())",
            "UPDATE portal.audit_logs SET action='TAMPERED'",
            "DELETE FROM portal.audit_logs",
            "TRUNCATE portal.audit_logs",
          ])
            await expectQueryError(db, sql, [], "42501");
        });
        await db.query(
          "UPDATE portal.staff_profiles SET role='HR' WHERE id=$1",
          [admin.id],
        );
        assert.equal(
          (
            await runtime(() =>
              db.query("SELECT count(*)::int n FROM portal.audit_logs"),
            )
          ).rows[0].n,
          0,
        );
        const roles = (
          await db.query(
            "SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='portal_audit_owner'",
          )
        ).rows[0];
        assert.deepEqual(roles, {
          rolcanlogin: false,
          rolsuper: false,
          rolbypassrls: false,
        });
      },
    );
  },
);
