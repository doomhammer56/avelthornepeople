import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expectQueryError } from "./helpers.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const managedAuth = JSON.parse(
  readFileSync(
    new URL("../../../prisma/external-auth.json", import.meta.url),
    "utf8",
  ),
);
const managedDDL =
  /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|SCHEMA|TYPE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:"auth"|auth)(?=[\s.;])/i;

function runPrisma(args, url) {
  return execFileSync(
    process.execPath,
    [path.join(root, "node_modules/prisma/build/index.js"), ...args],
    {
      cwd: root,
      env: { ...process.env, DIRECT_URL: url },
      encoding: "utf8",
      timeout: 90_000,
      windowsHide: true,
    },
  );
}

test("Supabase Auth database boundary", { timeout: 180_000 }, async (t) => {
  assert.ok(
    process.env.DIRECT_URL,
    "Set DIRECT_URL for the Supabase test project.",
  );
  const url = process.env.DIRECT_URL;
  const db = new pg.Client({
    connectionString: url,
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

  const version = await db.query("SHOW server_version");
  t.diagnostic(`PostgreSQL ${version.rows[0].server_version}`);
  const tables = await db.query(
    "SELECT 'auth.' || table_name AS name FROM information_schema.tables WHERE table_schema = 'auth' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  const enums = await db.query(
    "SELECT 'auth.' || t.typname AS name FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'auth' AND t.typtype = 'e' ORDER BY t.typname",
  );
  assert.ok(
    tables.rows.some((row) => row.name === "auth.users"),
    "Supabase Auth is required.",
  );
  for (const [kind, rows] of [
    ["tables", tables.rows],
    ["enums", enums.rows],
  ]) {
    for (const { name } of rows) {
      assert.ok(
        managedAuth[kind].includes(name),
        `Add ${name} to the managed Auth exclusions before generating migrations.`,
      );
    }
  }
  runPrisma(["migrate", "status"], url);
  await db.query("BEGIN");

  await t.test(
    "migration generation excludes every managed Auth object",
    () => {
      const sql = runPrisma(
        [
          "migrate",
          "diff",
          "--from-empty",
          "--to-schema",
          "prisma/schema.prisma",
          "--script",
        ],
        url,
      );
      assert.doesNotMatch(sql, managedDDL);
      assert.match(sql, /CONSTRAINT "staff_profiles_auth_user_fk"/);
    },
  );

  await t.test(
    "the deployed schema matches Prisma without Auth changes",
    () => {
      const sql = runPrisma(
        [
          "migrate",
          "diff",
          "--from-config-datasource",
          "--to-schema",
          "prisma/schema.prisma",
          "--script",
          "--exit-code",
        ],
        url,
      );
      assert.doesNotMatch(sql, managedDDL);
    },
  );

  await t.test(
    "profiles use the managed Auth UUID and safe defaults",
    async () => {
      const columns = await db.query(
        "SELECT column_name, udt_name, column_default FROM information_schema.columns WHERE table_schema = 'portal' AND table_name = 'staff_profiles'",
      );
      const byName = Object.fromEntries(
        columns.rows.map((column) => [column.column_name, column]),
      );
      assert.equal(byName.id.udt_name, "uuid");
      assert.equal(byName.id.column_default, null);
      assert.match(byName.role.column_default, /'READ_ONLY'/);
      assert.equal(byName.active.column_default, "false");
      const foreignKey = await db.query(
        "SELECT confrelid = 'auth.users'::regclass AS managed_auth, confdeltype, confupdtype FROM pg_constraint WHERE conname = 'staff_profiles_auth_user_fk' AND conrelid = 'portal.staff_profiles'::regclass",
      );
      assert.deepEqual(foreignKey.rows, [
        { managed_auth: true, confdeltype: "r", confupdtype: "a" },
      ]);
      await expectQueryError(
        db,
        "INSERT INTO portal.staff_profiles (id, display_name) VALUES ($1, 'Orphan')",
        [randomUUID()],
        "23503",
      );
      await expectQueryError(
        db,
        "INSERT INTO portal.staff_profiles (display_name) VALUES ('Missing ID')",
        [],
        "23502",
      );
    },
  );

  await t.test("profile names and roles are constrained", async () => {
    await expectQueryError(
      db,
      "INSERT INTO portal.staff_profiles (id, display_name, role) VALUES ($1, 'Test staff', 'SUPER_ADMIN')",
      [randomUUID()],
      "23514",
    );
    await expectQueryError(
      db,
      "INSERT INTO portal.staff_profiles (id, display_name) VALUES ($1, '  ')",
      [randomUUID()],
      "23514",
    );
    const trigger = await db.query(
      "SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'portal.staff_profiles'::regclass AND tgname = 'touch_updated_at' AND NOT tgisinternal",
    );
    assert.deepEqual(trigger.rows, [{ tgenabled: "O" }]);
  });

  await t.test(
    "departments enforce UUID defaults and unique nonempty codes",
    async () => {
      const code = `DB01_${randomUUID()}`;
      const { rows } = await db.query(
        "INSERT INTO portal.departments (code, name_zh) VALUES ($1, '工程') RETURNING active, pg_typeof(id)::text AS type",
        [code],
      );
      assert.deepEqual(rows, [{ active: true, type: "uuid" }]);
      await expectQueryError(
        db,
        "INSERT INTO portal.departments (id, code, name_zh) VALUES ('invalid', $1, '工程')",
        [randomUUID()],
        "22P02",
      );
      await expectQueryError(
        db,
        "INSERT INTO portal.departments (code, name_zh) VALUES ($1, '工程')",
        [code],
        "23505",
      );
      await expectQueryError(
        db,
        "INSERT INTO portal.departments (code, name_zh) VALUES (' ', '工程')",
        [],
        "23514",
      );
      await expectQueryError(
        db,
        "INSERT INTO portal.departments (code, name_zh) VALUES ($1, ' ')",
        [randomUUID()],
        "23514",
      );
    },
  );

  await t.test(
    "private tables enable RLS and deny provider roles",
    async () => {
      const { rows } = await db.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid IN ('portal.staff_profiles'::regclass, 'portal.departments'::regclass)",
      );
      assert.equal(rows.length, 2);
      assert.ok(rows.every((row) => row.relrowsecurity));
      for (const role of ["anon", "authenticated", "service_role"]) {
        await db.query("SAVEPOINT role_access");
        try {
          await db.query(`SET LOCAL ROLE ${role}`);
          await expectQueryError(
            db,
            "SELECT * FROM portal.staff_profiles",
            [],
            "42501",
          );
          await expectQueryError(
            db,
            "SELECT * FROM portal.departments",
            [],
            "42501",
          );
        } finally {
          await db.query("ROLLBACK TO SAVEPOINT role_access");
          await db.query("RELEASE SAVEPOINT role_access");
        }
      }
    },
  );
});
