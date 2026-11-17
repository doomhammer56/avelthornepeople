import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { loadAuthTestEnvironment } from "../../../scripts/auth/test-env.mjs";

loadAuthTestEnvironment();
const { authAdminClient } =
  await import("../../../src/server/adapters/auth/admin.ts");
const { identityClient } =
  await import("../../../src/server/adapters/auth/config.ts");
const { verifyIdentity } = await import("../../../src/server/auth/identity.ts");

test(
  "Auth SQL boundaries in the explicitly selected test project",
  { timeout: 180000 },
  async (t) => {
    const admin = authAdminClient();
    const db = new pg.Client({
      connectionString: process.env.DIRECT_URL,
      connectionTimeoutMillis: 15000,
      statement_timeout: 15000,
    });

    await t.test(
      "Separate runtime pools share the same atomic login budget",
      { timeout: 60000 },
      async (t) => {
        const { withRuntime } =
          await import("../../../src/server/database/runtime.ts");
        const pools = [0, 1].map(
          () =>
            new pg.Pool({
              connectionString: process.env.DATABASE_URL,
              max: 1,
              connectionTimeoutMillis: 15000,
            }),
        );
        const owner = new pg.Client({
          connectionString: process.env.DIRECT_URL,
          connectionTimeoutMillis: 15000,
        });
        const id = randomUUID();
        await owner.connect();
        t.after(async () => {
          for (const pool of pools) await pool.end();
          try {
            await owner.query(
              "DELETE FROM portal_private.auth_attempts WHERE id=$1",
              [id],
            );
          } finally {
            await owner.end();
          }
        });
        const results = await Promise.all(
          Array.from({ length: 10 }, (_, index) =>
            withRuntime(
              null,
              async (db) =>
                (
                  await db.query(
                    "SELECT portal_private.consume_auth_attempt($1::uuid,'account') AS allowed",
                    [id],
                  )
                ).rows[0].allowed,
              pools[index % 2],
            ),
          ),
        );
        assert.equal(results.filter(Boolean).length, 5);
      },
    );
    const users = [];
    await db.connect();
    t.after(async () => {
      await db.query("ROLLBACK").catch(() => {});
      await db.end();
      const failures = [];
      for (const user of users)
        if ((await admin.auth.admin.deleteUser(user.id)).error)
          failures.push(user.id);
      assert.equal(
        failures.length,
        0,
        "Synthetic Auth identity cleanup failed.",
      );
    });
    const known = await admin.auth.admin.getUserById(
      process.env.TEST_STAFF_USER_ID,
    );
    assert.equal(
      known.error,
      null,
      "Test identity and API project must match.",
    );
    assert.equal(
      (
        await db.query(
          "SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=$1::uuid) AS present",
          [known.data.user.id],
        )
      ).rows[0].present,
      true,
    );
    for (let i = 0; i < 3; i++) {
      const email = `auth01-${randomUUID()}@example.invalid`;
      const created = await admin.auth.admin.createUser({
        email,
        password: randomBytes(32).toString("base64url"),
        email_confirm: true,
        user_metadata: { role: "ADMIN" },
      });
      assert.equal(created.error, null, "Synthetic user creation failed.");
      users.push(created.data.user);
      const link = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      assert.equal(
        link.error,
        null,
        "Synthetic no-email link generation failed.",
      );
      const client = identityClient();
      const verified = await client.auth.verifyOtp({
        type: "magiclink",
        token_hash: link.data.properties.hashed_token,
      });
      assert.equal(verified.error, null, "Synthetic session creation failed.");
      users[i].identity = await verifyIdentity(
        verified.data.session.access_token,
      );
    }
    await db.query("BEGIN");
    const deployed = (
      await db.query(
        "SELECT to_regprocedure('portal_private.staff_session_is_live(uuid)') IS NOT NULL AS present",
      )
    ).rows[0].present;
    if (!deployed)
      await db.query(
        readFileSync(
          "prisma/migrations/20261020000100_staff_auth/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, " ")
          .replace(/COMMIT;\s*$/, " "),
      );
    const owner = (await db.query("SELECT current_user AS name")).rows[0].name;
    if (
      !(
        await db.query(
          "SELECT to_regprocedure('portal_private.begin_staff_login(uuid)') IS NOT NULL AS present",
        )
      ).rows[0].present
    )
      await db.query(
        readFileSync(
          "prisma/migrations/20261021000100_admin_login_lockout/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, " ")
          .replace(/COMMIT;\s*$/, " "),
      );
    // Test-only membership is inside this outer rollback transaction.
    if (
      !(
        await db.query(
          "SELECT to_regprocedure('portal_private.begin_password_change(uuid,bytea)') IS NOT NULL AS present",
        )
      ).rows[0].present
    )
      await db.query(
        readFileSync(
          "prisma/migrations/20261021000200_password_recovery_completion/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, " ")
          .replace(/COMMIT;\s*$/, " "),
      );
    await db.query(`GRANT portal_runtime TO ${pg.escapeIdentifier(owner)}`);
    await db.query(
      "INSERT INTO portal.staff_profiles(id,display_name,role,active) VALUES($1,'Auth fixture ADMIN','ADMIN',true),($2,'Auth fixture HR','HR',true)",
      [users[0].id, users[1].id],
    );
    // Privileged fixtures only: these links do not exercise password/CAPTCHA.
    for (const user of users.slice(0, 2))
      await db.query(
        "INSERT INTO portal_private.staff_session_admissions(session_id,subject_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [user.identity.sessionId, user.id],
      );

    async function as(user, action) {
      await db.query("SAVEPOINT auth_case");
      try {
        await db.query("SET LOCAL ROLE portal_runtime");
        await db.query(
          "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
          [
            user.id,
            JSON.stringify({
              sub: user.id,
              session_id: user.identity.sessionId,
              user_metadata: { role: "ADMIN" },
            }),
          ],
        );
        return await action();
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT auth_case");
      }
    }
    await t.test("Only the subject's live provider session is accepted", () =>
      as(users[0], async () => {
        assert.equal(
          (
            await db.query(
              "SELECT portal_private.staff_session_is_live($1::uuid) AS live",
              [users[0].identity.sessionId],
            )
          ).rows[0].live,
          true,
        );
        assert.equal(
          (
            await db.query(
              "SELECT portal_private.staff_session_is_live($1::uuid) AS live",
              [users[1].identity.sessionId],
            )
          ).rows[0].live,
          false,
        );
      }),
    );
    await t.test(
      "Portal success admits the verified session and resets four failures",
      () =>
        as(users[0], async () => {
          await db.query("RESET ROLE");
          await db.query(
            "DELETE FROM portal_private.staff_session_admissions WHERE session_id=$1",
            [users[0].identity.sessionId],
          );
          await db.query("SET LOCAL ROLE portal_runtime");
          const id = randomUUID();
          const reserve = async () =>
            (
              await db.query(
                "SELECT * FROM portal_private.begin_staff_login($1)",
                [id],
              )
            ).rows[0];
          for (let n = 0; n < 4; n++) {
            const r = await reserve();
            await db.query(
              "SELECT * FROM portal_private.finish_staff_login($1,$2,'invalid',NULL)",
              [id, r.reservation_id],
            );
          }
          assert.equal(
            (
              await db.query(
                "SELECT portal_private.staff_session_is_admitted($1) AS admitted",
                [users[0].identity.sessionId],
              )
            ).rows[0].admitted,
            false,
          );
          const r = await reserve();
          assert.equal(
            (
              await db.query(
                "SELECT * FROM portal_private.finish_staff_login($1,$2,'success',$3)",
                [id, r.reservation_id, users[0].identity.sessionId],
              )
            ).rows[0].outcome,
            "admitted",
          );
          assert.equal(
            (
              await db.query(
                "SELECT portal_private.staff_session_is_admitted($1) AS admitted",
                [users[0].identity.sessionId],
              )
            ).rows[0].admitted,
            true,
          );
          const next = await reserve();
          await db.query(
            "SELECT * FROM portal_private.finish_staff_login($1,$2,'invalid',NULL)",
            [id, next.reservation_id],
          );
          await db.query("RESET ROLE");
          assert.equal(
            (
              await db.query(
                "SELECT failures FROM portal_private.login_states WHERE id=$1",
                [id],
              )
            ).rows[0].failures,
            1,
          );
        }),
    );
    await t.test("An editable ADMIN metadata claim cannot promote HR", () =>
      as(users[1], async () => {
        await assert.rejects(
          db.query(
            "SELECT portal_private.link_staff($1::uuid,'Denied',$2::uuid)",
            [users[2].id, randomUUID()],
          ),
          { code: "42501" },
        );
      }),
    );
    await t.test(
      "Authorized linkage is idempotent and defaults inactive/read-only",
      () =>
        as(users[0], async () => {
          for (let i = 0; i < 2; i++)
            await db.query(
              "SELECT portal_private.link_staff($1::uuid,'New staff',$2::uuid)",
              [users[2].id, randomUUID()],
            );
          // Admin may inspect the newly linked inactive profile via existing RLS.
          const row = (
            await db.query(
              "SELECT role,active FROM portal.staff_profiles WHERE id=$1",
              [users[2].id],
            )
          ).rows[0];
          assert.deepEqual(row, { role: "READ_ONLY", active: false });
        }),
    );
    await t.test(
      "Account changes require fresh authorization and prevent self-lockout",
      () =>
        as(users[0], async () => {
          await assert.rejects(
            db.query(
              "SELECT portal_private.manage_team_change($1::uuid,(SELECT version FROM portal.staff_profiles WHERE id=$1),'HR',false,$2::uuid)",
              [users[0].id, randomUUID()],
            ),
            { code: "42501" },
          );
        }),
    );
    await t.test(
      "Invitation retries reserve once and retain inactive safe linkage",
      () =>
        as(users[0], async () => {
          const request = randomUUID(),
            hash = createHash("sha256").update(randomBytes(32)).digest();
          assert.deepEqual(
            (
              await db.query(
                "SELECT * FROM portal_private.reserve_staff_invitation($1::uuid,$2)",
                [request, hash],
              )
            ).rows[0],
            { reserved: true, profile_id: null },
          );
          assert.deepEqual(
            (
              await db.query(
                "SELECT * FROM portal_private.reserve_staff_invitation($1::uuid,$2)",
                [request, hash],
              )
            ).rows[0],
            { reserved: false, profile_id: null },
          );
          await db.query(
            "SELECT portal_private.complete_staff_invitation($1::uuid,$2::uuid,'Invited staff')",
            [request, users[2].id],
          );
          assert.deepEqual(
            (
              await db.query(
                "SELECT role,active FROM portal.staff_profiles WHERE id=$1",
                [users[2].id],
              )
            ).rows[0],
            { role: "READ_ONLY", active: false },
          );
          assert.deepEqual(
            (
              await db.query(
                "SELECT * FROM portal_private.reserve_staff_invitation($1::uuid,$2)",
                [request, hash],
              )
            ).rows[0],
            { reserved: false, profile_id: users[2].id },
          );
        }),
    );
    await t.test(
      "Revocation, pending provider work and safe audits commit together",
      () =>
        as(users[0], async () => {
          const request = randomUUID();
          const op = (
            await db.query(
              "SELECT (portal_private.manage_team_change($1::uuid,(SELECT version FROM portal.staff_profiles WHERE id=$1),'HR',false,$2::uuid)->>'operationId')::uuid AS id",
              [users[1].id, request],
            )
          ).rows[0].id;
          assert.ok(op);
          assert.deepEqual(
            (
              await db.query(
                "SELECT * FROM portal_private.pending_staff_provider_operation($1::uuid)",
                [op],
              )
            ).rows,
            [{ profile_id: users[1].id, operation: "ban" }],
          );
          const audit = (
            await db.query(
              "SELECT safe_changes FROM portal.audit_logs WHERE request_id=$1",
              [request],
            )
          ).rows[0].safe_changes;
          assert.deepEqual(Object.keys(audit).sort(), [
            "active",
            "oldActive",
            "oldRole",
            "role",
          ]);
          const claimId = randomUUID();
          await db.query(
            "SELECT * FROM portal_private.claim_staff_provider_operation($1,$2)",
            [op, claimId],
          );
          await db.query(
            "SELECT portal_private.finish_staff_provider_claim($1,$2,true)",
            [op, claimId],
          );
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int AS count FROM portal_private.pending_staff_provider_operation($1::uuid)",
                [op],
              )
            ).rows[0].count,
            0,
          );
        }),
    );
    await t.test(
      "Distributed limiter enforces fixed budgets and resets expired windows",
      () =>
        as(users[0], async () => {
          const id = randomUUID();
          for (let i = 1; i <= 6; i++)
            assert.equal(
              (
                await db.query(
                  "SELECT portal_private.consume_auth_attempt($1::uuid,'account') AS allowed",
                  [id],
                )
              ).rows[0].allowed,
              i <= 5,
            );
          await db.query("RESET ROLE");
          await db.query(
            "UPDATE portal_private.auth_attempts SET window_start=now()-interval '16 minutes' WHERE id=$1",
            [id],
          );
          await db.query("SET LOCAL ROLE portal_runtime");
          assert.equal(
            (
              await db.query(
                "SELECT portal_private.consume_auth_attempt($1::uuid,'account') AS allowed",
                [id],
              )
            ).rows[0].allowed,
            true,
          );
        }),
    );
    await t.test(
      "Password operations preserve safe retries, fence stale results and revoke prior app sessions",
      () =>
        as(users[0], async () => {
          const hash = createHash("sha256").update(randomBytes(32)).digest(),
            sid = users[0].identity.sessionId;
          await db.query("SELECT portal_private.create_password_grant($1,$2)", [
            sid,
            hash,
          ]);
          const valid = async () =>
            (
              await db.query(
                "SELECT portal_private.password_grant_is_valid($1,$2) AS allowed",
                [sid, hash],
              )
            ).rows[0].allowed;
          const begin = async () =>
            (
              await db.query(
                "SELECT portal_private.begin_password_change($1,$2) AS ticket",
                [sid, hash],
              )
            ).rows[0].ticket;
          const finish = async (ticket, result) =>
            (
              await db.query(
                "SELECT portal_private.finish_password_change($1,$2,$3,$4) AS allowed",
                [sid, hash, ticket, result],
              )
            ).rows[0].allowed;
          assert.equal(await valid(), true);
          const first = await begin();
          assert.ok(first);
          assert.equal(await valid(), false);
          assert.equal(await begin(), null);
          assert.equal(await finish(first, "retry"), true);
          assert.equal(await valid(), true);
          const second = await begin();
          assert.notEqual(second, first);
          assert.equal(await finish(first, "retry"), false);
          assert.equal(await finish(second, "complete"), true);
          assert.equal(await finish(second, "retry"), false);
          assert.equal(await finish(second, "complete"), true);
          assert.equal(await valid(), false);
          assert.equal(
            (
              await db.query(
                "SELECT portal_private.staff_session_is_admitted($1) AS allowed",
                [sid],
              )
            ).rows[0].allowed,
            false,
          );
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int AS count FROM portal.audit_logs WHERE request_id=$1 AND action='PASSWORD_CHANGED'",
                [second],
              )
            ).rows[0].count,
            1,
          );
        }),
    );
    await t.test(
      "Expired password grants cannot be reserved and browser roles have no new command access",
      () =>
        as(users[0], async () => {
          const hash = createHash("sha256").update(randomBytes(32)).digest(),
            sid = users[0].identity.sessionId;
          await db.query("SELECT portal_private.create_password_grant($1,$2)", [
            sid,
            hash,
          ]);
          await db.query("RESET ROLE");
          await db.query(
            "UPDATE portal_private.password_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",
            [hash],
          );
          await db.query("SET LOCAL ROLE portal_runtime");
          assert.equal(
            (
              await db.query(
                "SELECT portal_private.begin_password_change($1,$2) AS ticket",
                [sid, hash],
              )
            ).rows[0].ticket,
            null,
          );
          for (const role of ["anon", "authenticated", "service_role"])
            for (const fn of [
              "password_grant_is_valid(uuid,bytea)",
              "begin_password_change(uuid,bytea)",
              "finish_password_change(uuid,bytea,uuid,text)",
            ])
              assert.equal(
                (
                  await db.query(
                    "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
                    [role, `portal_private.${fn}`],
                  )
                ).rows[0].allowed,
                false,
              );
        }),
    );
    await t.test("Password setup grants are session-bound and single use", () =>
      as(users[0], async () => {
        const hash = createHash("sha256").update(randomBytes(32)).digest();
        await db.query(
          "SELECT portal_private.create_password_grant($1::uuid,$2)",
          [users[0].identity.sessionId, hash],
        );
        assert.equal(
          (
            await db.query(
              "SELECT portal_private.consume_password_grant($1::uuid,$2) AS allowed",
              [users[1].identity.sessionId, hash],
            )
          ).rows[0].allowed,
          false,
        );
        for (const expected of [true, false])
          assert.equal(
            (
              await db.query(
                "SELECT portal_private.consume_password_grant($1::uuid,$2) AS allowed",
                [users[0].identity.sessionId, hash],
              )
            ).rows[0].allowed,
            expected,
          );
      }),
    );
    await t.test(
      "Browser roles cannot execute private auth helpers or read infrastructure",
      async () => {
        for (const role of ["anon", "authenticated", "service_role"]) {
          assert.equal(
            (
              await db.query(
                "SELECT has_function_privilege($1,'portal_private.staff_session_is_live(uuid)','EXECUTE') AS allowed",
                [role],
              )
            ).rows[0].allowed,
            false,
          );
          assert.equal(
            (
              await db.query(
                "SELECT has_table_privilege($1,'portal_private.auth_attempts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",
                [role],
              )
            ).rows[0].allowed,
            false,
          );
        }
      },
    );
    await t.test(
      "The same unexpired JWT fails the live-session check after sign-out",
      async () => {
        // Release fixture admission FKs before the external provider deletes the
        // referenced session; holding the outer transaction would block sign-out.
        await db.query("ROLLBACK");
        const result = await admin.auth.admin.signOut(
          users[0].identity.token,
          "local",
        );
        assert.equal(result.error, null);
        await db.query("BEGIN");
        await db.query(`GRANT portal_runtime TO ${pg.escapeIdentifier(owner)}`);
        await as(users[0], async () => {
          assert.equal(
            (
              await db.query(
                "SELECT portal_private.staff_session_is_live($1::uuid) AS live",
                [users[0].identity.sessionId],
              )
            ).rows[0].live,
            false,
          );
        });
      },
    );
  },
);
