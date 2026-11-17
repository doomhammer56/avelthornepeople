import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { expectQueryError } from "./helpers.mjs";

test("Location persistence", { timeout: 120_000 }, async (t) => {
  assert.ok(process.env.DIRECT_URL, "DIRECT_URL is required.");
  const db = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 15_000,
  });
  await db.connect();
  t.after(async () => {
    try {
      await db.query("ROLLBACK");
    } finally {
      await db.end();
    }
  });
  await db.query("BEGIN");

  const insert =
    "INSERT INTO portal.locations (code, name_zh, country_code, timezone) VALUES ($1, $2, $3, $4)";
  const code = `DB01_LOC_${randomUUID()}`;

  await t.test(
    "stores bilingual fields with a UUID and active default",
    async () => {
      const { rows } = await db.query(
        `${insert} RETURNING id, active, name_en, address_zh, address_en`,
        [code, "基加利", "RW", "Africa/Kigali"],
      );
      assert.match(
        rows[0].id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      assert.deepEqual(rows[0], {
        id: rows[0].id,
        active: true,
        name_en: null,
        address_zh: null,
        address_en: null,
      });
      const updated = await db.query(
        "UPDATE portal.locations SET name_en = 'Kigali', address_zh = '测试地址', address_en = 'Test address', active = false WHERE id = $1 RETURNING name_en, address_zh, address_en, active",
        [rows[0].id],
      );
      assert.deepEqual(updated.rows, [
        {
          name_en: "Kigali",
          address_zh: "测试地址",
          address_en: "Test address",
          active: false,
        },
      ]);
    },
  );

  await t.test("rejects duplicate codes and invalid UUIDs", async () => {
    await expectQueryError(
      db,
      insert,
      [code, "基加利", "RW", "Africa/Kigali"],
      "23505",
    );
    await expectQueryError(
      db,
      "INSERT INTO portal.locations (id, code, name_zh, country_code, timezone) VALUES ('invalid', $1, '基加利', 'RW', 'Africa/Kigali')",
      [randomUUID()],
      "22P02",
    );
  });

  await t.test(
    "enforces required names, country format and timezone",
    async () => {
      const valid = [randomUUID(), "基加利", "RW", "Africa/Kigali"];
      for (const [column, value, error] of [
        [0, null, "23502"],
        [0, "  ", "23514"],
        [1, null, "23502"],
        [1, "  ", "23514"],
        [2, null, "23502"],
        [2, "rw", "23514"],
        [2, "RWA", "23514"],
        [3, null, "23502"],
        [3, "  ", "23514"],
      ]) {
        const parameters = [...valid];
        parameters[column] = value;
        await expectQueryError(db, insert, parameters, error);
      }
      await expectQueryError(
        db,
        "UPDATE portal.locations SET country_code = 'rw' WHERE code = $1",
        [code],
        "23514",
      );
    },
  );

  await t.test("enables RLS and denies ungranted role access", async () => {
    const rls = await db.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'portal.locations'::regclass",
    );
    assert.deepEqual(rls.rows, [{ relrowsecurity: true }]);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const privileges = await db.query(
        "SELECT has_table_privilege($1, 'portal.locations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed",
        [role],
      );
      assert.deepEqual(privileges.rows, [{ allowed: false }]);
      await db.query("SAVEPOINT role_access");
      try {
        await db.query(`SET LOCAL ROLE ${role}`);
        await expectQueryError(
          db,
          "SELECT * FROM portal.locations",
          [],
          "42501",
        );
        await expectQueryError(
          db,
          insert,
          [randomUUID(), "基加利", "RW", "Africa/Kigali"],
          "42501",
        );
      } finally {
        await db.query("ROLLBACK TO SAVEPOINT role_access");
        await db.query("RELEASE SAVEPOINT role_access");
      }
    }
  });
});
