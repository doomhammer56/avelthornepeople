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
  "Admin reference commands persist all lists, reject HR/Read-Only and stale writes, and feed public labels",
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
          "SELECT to_regprocedure('portal_private.manage_job_reference(text,uuid,integer,uuid,jsonb)') IS NOT NULL ready",
        )
      ).rows[0].ready
    )
      await db.query(
        readFileSync(
          "prisma/migrations/20261026000500_job_reference_management/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, "")
          .replace(/COMMIT;\s*$/, ""),
      );
    await db.query(
      "GRANT portal_runtime,portal_public_reader,portal_jobs_owner TO CURRENT_USER",
    );
    for (const role of ["ADMIN", "HR", "READ_ONLY"])
      users.push(await createStaffSession(db, role));
    async function as(user, action) {
      await db.query(
        "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
        [user.id, JSON.stringify({ sub: user.id, session_id: user.sessionId })],
      );
      await db.query("SET LOCAL ROLE portal_runtime");
      try {
        return await action();
      } finally {
        await db.query("RESET ROLE");
      }
    }
    const sql =
      "SELECT portal_private.manage_job_reference($1,$2,$3,$4,$5) result";
    for (const category of [
      "department",
      "location",
      "jobType",
      "experience",
    ]) {
      const id = randomUUID(),
        request = randomUUID();
      const value = {
        code: `REF_${randomUUID().replaceAll("-", "").toUpperCase()}`,
        nameEn: "Reference option",
        nameZh: "测试选项",
        active: true,
        ...(category === "location"
          ? { countryCode: "MY", timeZone: "Asia/Kuala_Lumpur" }
          : {}),
      };
      for (const user of users.slice(1))
        await as(user, () =>
          expectQueryError(
            db,
            sql,
            [category, id, 0, request, JSON.stringify(value)],
            "42501",
          ),
        );
      const create = await as(users[0], () =>
        db.query(sql, [category, id, 0, request, JSON.stringify(value)]),
      );
      assert.deepEqual(create.rows[0].result, { id, version: 1 });
      assert.deepEqual(
        (
          await as(users[0], () =>
            db.query(sql, [category, id, 0, request, JSON.stringify(value)]),
          )
        ).rows,
        create.rows,
      );
      const updated = { ...value, nameEn: "Updated option", active: false };
      assert.equal(
        (
          await as(users[0], () =>
            db.query(sql, [
              category,
              id,
              1,
              randomUUID(),
              JSON.stringify(updated),
            ]),
          )
        ).rows[0].result.version,
        2,
      );
      await as(users[0], () =>
        expectQueryError(
          db,
          sql,
          [category, id, 1, randomUUID(), JSON.stringify(value)],
          "40001",
        ),
      );
      assert.equal(
        (
          await as(users[0], () =>
            db.query(sql, [
              category,
              id,
              2,
              randomUUID(),
              JSON.stringify(updated),
            ]),
          )
        ).rows[0].result.version,
        2,
      );
      const table =
        category === "department"
          ? "departments"
          : category === "location"
            ? "locations"
            : "job_options";
      assert.equal(
        (
          await db.query(`SELECT name_en FROM portal.${table} WHERE id=$1`, [
            id,
          ])
        ).rows[0].name_en,
        "Updated option",
      );
      if (table === "job_options") {
        assert.equal(
          Number(
            (
              await db.query(
                "SELECT count(*) FROM portal.audit_logs WHERE object_id=$1",
                [id],
              )
            ).rows[0].count,
          ),
          2,
        );
        await db.query("SET LOCAL ROLE portal_public_reader");
        assert.equal(
          (
            await db.query(
              "SELECT name_en FROM portal.public_job_options WHERE kind=$1 AND code=$2",
              [category, value.code],
            )
          ).rows[0].name_en,
          "Updated option",
        );
        await db.query("RESET ROLE");
      }
    }
    await db.query("SET LOCAL ROLE portal_jobs_owner");
    await expectQueryError(
      db,
      "SELECT portal_private.validate_job_draft($1,false,false)",
      [
        JSON.stringify({
          en: { title: "", responsibilities: [], requirements: [] },
          zh: { title: "", responsibilities: [], requirements: [] },
          settings: {
            departmentId: null,
            locationIds: [],
            jobType: "UNKNOWN",
            experience: "ANY",
            salary: null,
            showSalary: false,
            publishAt: null,
            closeAt: null,
          },
        }),
      ],
      "22023",
    );
  },
);
