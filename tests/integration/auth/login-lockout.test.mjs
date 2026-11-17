import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
loadAuthTestEnvironment();
const owner = () =>
  connectAuthTestDatabase(
    () =>
      new pg.Client({
        connectionString: process.env.DIRECT_URL,
        connectionTimeoutMillis: 15000,
        statement_timeout: 15000,
      }),
  );
const begin = async (db, id) =>
  (await db.query("SELECT * FROM portal_private.begin_staff_login($1)", [id]))
    .rows[0];
const finish = async (db, id, ticket, result) =>
  (
    await db.query(
      "SELECT * FROM portal_private.finish_staff_login($1,$2,$3,NULL)",
      [id, ticket, result],
    )
  ).rows[0];

test(
  "Lockout state transitions, timing, isolation and migration preview",
  { timeout: 120000 },
  async (t) => {
    const db = await owner();
    t.after(async () => {
      await db.query("ROLLBACK");
      await db.end();
    });
    await db.query("BEGIN");
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
    const role = (await db.query("SELECT current_user AS name")).rows[0].name;
    await db.query(`GRANT portal_runtime TO ${pg.escapeIdentifier(role)}`);
    const runtime = async (action) => {
      await db.query("SET LOCAL ROLE portal_runtime");
      try {
        return await action();
      } finally {
        await db.query("RESET ROLE");
      }
    };
    const failure = async (id) =>
      runtime(async () => {
        const reservation = await begin(db, id);
        assert.equal(reservation.outcome, "ready");
        return finish(db, id, reservation.reservation_id, "invalid");
      });
    await t.test(
      "Fifth credential failure starts a full new 900-second lock, independent of old windows",
      async () => {
        const id = randomUUID();
        for (let n = 1; n <= 4; n++)
          assert.deepEqual(await failure(id), {
            outcome: "invalid",
            retry_after_seconds: 0,
          });
        await db.query(
          "UPDATE portal_private.login_states SET updated_at=now()-interval '30 days' WHERE id=$1",
          [id],
        );
        assert.deepEqual(await failure(id), {
          outcome: "locked",
          retry_after_seconds: 900,
        });
        const state = (
          await db.query(
            "SELECT * FROM portal_private.login_states WHERE id=$1",
            [id],
          )
        ).rows[0];
        assert.equal(state.failures, 5);
        assert.equal(state.locked_until - state.locked_at, 900000);
        assert.ok(Date.now() - state.locked_at.getTime() < 10000);
        for (let n = 0; n < 3; n++) {
          const result = await runtime(() => begin(db, id));
          assert.equal(result.outcome, "locked");
          assert.ok(
            result.retry_after_seconds > 890 &&
              result.retry_after_seconds <= 900,
          );
        }
        assert.equal(
          (
            await db.query(
              "SELECT locked_until FROM portal_private.login_states WHERE id=$1",
              [id],
            )
          ).rows[0].locked_until.getTime(),
          state.locked_until.getTime(),
        );
        // Owner-only clock fixtures: no production clock override or 15-minute sleep.
        await db.query(
          "WITH clock AS (SELECT clock_timestamp() AS instant) UPDATE portal_private.login_states SET locked_at=clock.instant-interval '14 minutes 55 seconds',locked_until=clock.instant+interval '5 seconds' FROM clock WHERE id=$1",
          [id],
        );
        const near = await runtime(() => begin(db, id));
        assert.equal(near.outcome, "locked");
        assert.ok(
          near.retry_after_seconds > 0 && near.retry_after_seconds <= 5,
        );
        await db.query(
          "WITH clock AS (SELECT clock_timestamp() AS instant) UPDATE portal_private.login_states SET locked_at=clock.instant-interval '15 minutes',locked_until=clock.instant FROM clock WHERE id=$1",
          [id],
        );
        const expired = await runtime(() => begin(db, id));
        assert.equal(expired.outcome, "ready");
        assert.equal(
          (
            await db.query(
              "SELECT failures FROM portal_private.login_states WHERE id=$1",
              [id],
            )
          ).rows[0].failures,
          0,
        );
        assert.equal(
          (
            await runtime(() =>
              finish(db, id, expired.reservation_id, "invalid"),
            )
          ).outcome,
          "invalid",
        );
      },
    );
    await t.test(
      "Abort and housekeeping preserve nonzero counters; recovery uses separate state",
      async () => {
        const id = randomUUID();
        await failure(id);
        await db.query(
          "UPDATE portal_private.login_states SET updated_at=now()-interval '90 days' WHERE id=$1",
          [id],
        );
        const reservation = await runtime(() => begin(db, id));
        await runtime(() =>
          finish(db, id, reservation.reservation_id, "abort"),
        );
        for (let i = 0; i < 6; i++)
          await runtime(() =>
            db.query(
              "SELECT portal_private.consume_login_traffic($1,'account')",
              [randomUUID()],
            ),
          );
        assert.equal(
          (
            await db.query(
              "SELECT failures FROM portal_private.login_states WHERE id=$1",
              [id],
            )
          ).rows[0].failures,
          1,
        );
      },
    );
    await t.test(
      "Expired leases can be reclaimed; late successes and failures are fenced out",
      async () => {
        const id = randomUUID(),
          first = await runtime(() => begin(db, id));
        const busy = await runtime(() => begin(db, id));
        assert.equal(busy.outcome, "busy");
        await db.query(
          "UPDATE portal_private.login_states SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
          [id],
        );
        const second = await runtime(() => begin(db, id));
        assert.notEqual(first.reservation_id, second.reservation_id);
        for (const result of ["invalid", "success", "abort"])
          assert.equal(
            (await runtime(() => finish(db, id, first.reservation_id, result)))
              .outcome,
            "stale",
          );
        assert.equal(
          (
            await runtime(() =>
              finish(db, id, second.reservation_id, "invalid"),
            )
          ).outcome,
          "invalid",
        );
        assert.equal(
          (
            await db.query(
              "SELECT failures FROM portal_private.login_states WHERE id=$1",
              [id],
            )
          ).rows[0].failures,
          1,
        );
      },
    );
    await t.test(
      "Missing staff/session cannot admit or reset failures",
      async () => {
        const id = randomUUID();
        await failure(id);
        const reservation = await runtime(() => begin(db, id));
        assert.equal(
          (
            await runtime(() =>
              finish(db, id, reservation.reservation_id, "success"),
            )
          ).outcome,
          "denied",
        );
        assert.equal(
          (
            await db.query(
              "SELECT failures FROM portal_private.login_states WHERE id=$1",
              [id],
            )
          ).rows[0].failures,
          1,
        );
      },
    );
    await t.test(
      "Browser/runtime roles cannot read or write security tables; only runtime executes commands",
      async () => {
        for (const role of [
          "anon",
          "authenticated",
          "service_role",
          "portal_runtime",
        ]) {
          for (const table of ["login_states", "staff_session_admissions"])
            assert.equal(
              (
                await db.query(
                  "SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",
                  [role, `portal_private.${table}`],
                )
              ).rows[0].allowed,
              false,
            );
          for (const fn of [
            "begin_staff_login(uuid)",
            "finish_staff_login(uuid,uuid,text,uuid)",
            "staff_session_is_admitted(uuid)",
            "consume_login_traffic(uuid,text)",
          ])
            assert.equal(
              (
                await db.query(
                  "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
                  [role, `portal_private.${fn}`],
                )
              ).rows[0].allowed,
              role === "portal_runtime",
            );
        }
      },
    );
  },
);

test(
  "Independent runtime pools serialize credential reservations and preserve the fifth failure",
  { timeout: 120000 },
  async (t) => {
    const db = await owner(),
      id = randomUUID();
    const { withRuntime } =
      await import("../../../src/server/database/runtime.ts");
    const pools = [0, 1].map(
      () =>
        new pg.Pool({
          connectionString: process.env.DATABASE_URL,
          max: 2,
          connectionTimeoutMillis: 15000,
        }),
    );
    t.after(async () => {
      for (const pool of pools) await pool.end();
      try {
        await db.query("DELETE FROM portal_private.login_states WHERE id=$1", [
          id,
        ]);
      } finally {
        await db.end();
      }
    });
    for (let round = 0; round < 5; round++) {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          withRuntime(
            null,
            (connection) => begin(connection, id),
            pools[i % 2],
          ),
        ),
      );
      assert.equal(results.filter((x) => x.outcome === "ready").length, 1);
      assert.equal(results.filter((x) => x.outcome === "busy").length, 7);
      const ticket = results.find((x) => x.outcome === "ready").reservation_id;
      assert.equal(
        (
          await withRuntime(
            null,
            (connection) => finish(connection, id, ticket, "invalid"),
            pools[0],
          )
        ).outcome,
        round === 4 ? "locked" : "invalid",
      );
    }
    const locked = await Promise.all(
      pools.map((pool) =>
        withRuntime(null, (connection) => begin(connection, id), pool),
      ),
    );
    assert.ok(locked.every((x) => x.outcome === "locked"));
    assert.equal(
      (
        await db.query(
          "SELECT failures FROM portal_private.login_states WHERE id=$1",
          [id],
        )
      ).rows[0].failures,
      5,
    );
  },
);
