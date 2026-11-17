import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
import { expectQueryError } from "../database/helpers.mjs";
loadAuthTestEnvironment();
const { createStaffSession } = await import("../../helpers/staff-session.mjs");

test(
  "Versioned team changes enforce live RBAC, replay safety and revocation",
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
      for (const user of users) await user.remove();
    });
    await db.query("BEGIN");
    if (
      !(
        await db.query(
          "SELECT to_regprocedure('portal_private.manage_team_change(uuid,integer,text,boolean,uuid)') IS NOT NULL ready",
        )
      ).rows[0].ready
    )
      await db.query(
        readFileSync(
          "prisma/migrations/20261026000300_team_rbac/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, "")
          .replace(/COMMIT;\s*$/, ""),
      );
    await db.query("GRANT portal_runtime TO CURRENT_USER");
    for (const role of ["ADMIN", "HR", "READ_ONLY"])
      users.push(await createStaffSession(db, role));
    const [admin, hr, reader] = users;
    async function as(user, fn, extra = {}) {
      await db.query("SAVEPOINT caller");
      try {
        await db.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
          [
            user.id,
            JSON.stringify({
              sub: user.id,
              session_id: user.sessionId,
              ...extra,
            }),
          ],
        );
        await db.query("SET LOCAL ROLE portal_runtime");
        const result = await fn();
        await db.query("RESET ROLE");
        await db.query("RELEASE SAVEPOINT caller");
        return result;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT caller");
        await db.query("RELEASE SAVEPOINT caller");
        throw error;
      }
    }
    const change = (
      user,
      target,
      version,
      role,
      active,
      requestId = randomUUID(),
    ) =>
      as(
        user,
        async () =>
          (
            await db.query(
              "SELECT portal_private.manage_team_change($1,$2,$3,$4,$5) result",
              [target, version, role, active, requestId],
            )
          ).rows[0].result,
      );
    await t.test(
      "HR/Read-Only and forged metadata cannot manage staff; unversioned runtime updates are revoked",
      async () => {
        for (const user of [hr, reader])
          await assert.rejects(change(user, hr.id, 1, "ADMIN", true), {
            code: "42501",
          });
        await as(
          hr,
          () =>
            expectQueryError(
              db,
              "SELECT portal_private.manage_team_change($1,1,'ADMIN',true,$2)",
              [hr.id, randomUUID()],
              "42501",
            ),
          { role: "ADMIN", app_metadata: { role: "ADMIN" } },
        );
        await as(admin, () =>
          expectQueryError(
            db,
            "SELECT portal_private.change_staff($1,'HR',false,$2)",
            [hr.id, randomUUID()],
            "42501",
          ),
        );
        await as(admin, () =>
          expectQueryError(
            db,
            "SELECT * FROM portal_private.team_commands",
            [],
            "42501",
          ),
        );
      },
    );
    const first = randomUUID();
    await t.test(
      "changes advance versions and commit one safe audit/outbox record",
      async () => {
        const result = await change(admin, hr.id, 1, "READ_ONLY", true, first);
        assert.equal(result.version, 2);
        assert.equal(result.operationId, null);
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal.audit_logs WHERE request_id=$1 AND action='STAFF_CHANGED'",
              [first],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal.outbox_events WHERE delivery_key=$1",
              [`staff-change:${first}`],
            )
          ).rows[0].n,
          1,
        );
        assert.ok(
          !JSON.stringify(
            (
              await db.query(
                "SELECT command,result FROM portal_private.team_commands WHERE request_id=$1",
                [first],
              )
            ).rows,
          ).includes("Synthetic staff"),
        );
      },
    );
    await t.test(
      "replays never revert a later role change and request collisions/stale writes fail",
      async () => {
        await change(admin, hr.id, 2, "HR", true);
        assert.equal(
          (await change(admin, hr.id, 1, "READ_ONLY", true, first)).version,
          2,
        );
        assert.equal(
          (
            await db.query(
              "SELECT role,version FROM portal.staff_profiles WHERE id=$1",
              [hr.id],
            )
          ).rows[0].role,
          "HR",
        );
        await assert.rejects(change(admin, hr.id, 1, "ADMIN", true), {
          code: "40001",
        });
        await assert.rejects(change(admin, hr.id, 1, "ADMIN", true, first), {
          code: "40001",
        });
        const noop = randomUUID();
        assert.equal(
          (await change(admin, hr.id, 3, "HR", true, noop)).version,
          3,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal.audit_logs WHERE request_id=$1",
              [noop],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "self-lockout is rejected and changed roles immediately revoke old admissions",
      async () => {
        await assert.rejects(change(admin, admin.id, 1, "HR", true), {
          code: "42501",
        });
        await assert.rejects(change(admin, admin.id, 1, "ADMIN", false), {
          code: "42501",
        });
        assert.equal(
          (
            await as(hr, () =>
              db.query(
                "SELECT portal_private.staff_session_is_admitted($1) live",
                [hr.sessionId],
              ),
            )
          ).rows[0].live,
          false,
        );
      },
    );
    await t.test(
      "pending provider operations are readable after reload and block new transitions until reconciled",
      async () => {
        const result = await change(admin, reader.id, 1, "READ_ONLY", false);
        assert.ok(result.operationId);
        const pending = await as(admin, () =>
          db.query(
            "SELECT * FROM portal_private.pending_team_operations($1::uuid[])",
            [[reader.id]],
          ),
        );
        assert.deepEqual(pending.rows, [
          { profile_id: reader.id, operation_id: result.operationId },
        ]);
        await assert.rejects(change(admin, reader.id, 2, "HR", true), {
          code: "55000",
        });
        await as(admin, async () => {
          const claimId = randomUUID();
          await db.query(
            "SELECT * FROM portal_private.claim_staff_provider_operation($1,$2)",
            [result.operationId, claimId],
          );
          await db.query(
            "SELECT portal_private.finish_staff_provider_claim($1,$2,true)",
            [result.operationId, claimId],
          );
        });
        assert.equal(
          (
            await as(admin, () =>
              db.query(
                "SELECT * FROM portal_private.pending_team_operations($1::uuid[])",
                [[reader.id]],
              ),
            )
          ).rows.length,
          0,
        );
        await as(admin, () =>
          expectQueryError(
            db,
            "SELECT * FROM portal_private.pending_team_operations($1::uuid[])",
            [Array(51).fill(reader.id)],
            "22023",
          ),
        );
      },
    );
    await t.test(
      "outbox failure rolls back the role/version, primary audit and replay record",
      async () => {
        const request = randomUUID();
        await db.query(
          "INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key) VALUES('TEST',$1,$2)",
          [hr.id, `staff-change:${request}`],
        );
        await assert.rejects(
          change(admin, hr.id, 3, "READ_ONLY", true, request),
          { code: "23505" },
        );
        assert.deepEqual(
          (
            await db.query(
              "SELECT role,version FROM portal.staff_profiles WHERE id=$1",
              [hr.id],
            )
          ).rows,
          [{ role: "HR", version: 3 }],
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal.audit_logs WHERE request_id=$1",
              [request],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int n FROM portal_private.team_commands WHERE request_id=$1",
              [request],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      "profile versions include name changes and cannot be manually reset",
      async () => {
        await db.query(
          "UPDATE portal.staff_profiles SET display_name='Team Version Canary' WHERE id=$1",
          [hr.id],
        );
        await db.query(
          "UPDATE portal.staff_profiles SET version=1 WHERE id=$1",
          [hr.id],
        );
        assert.equal(
          (
            await db.query(
              "SELECT version FROM portal.staff_profiles WHERE id=$1",
              [hr.id],
            )
          ).rows[0].version,
          4,
        );
        assert.ok(
          !JSON.stringify(
            (
              await db.query(
                "SELECT command,result FROM portal_private.team_commands WHERE actor_id=$1",
                [admin.id],
              )
            ).rows,
          ).includes("Team Version Canary"),
        );
      },
    );
  },
);
