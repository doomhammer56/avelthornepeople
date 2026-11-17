import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "../../../prisma/migrations/20261117000100_staff_self_service/migration.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
// Only the function body runs here; the audit-code wrapper and grants need the real roles.
const start = sql.indexOf("CREATE FUNCTION portal_private.rename_own_profile");
const end = sql.indexOf("REVOKE ALL ON FUNCTION");
const fn = sql.slice(start, end);

test("rename_own_profile only renames the caller, validates, audits changes and bumps nothing else", async () => {
  const db = new PGlite();
  await db.exec(`
create schema portal; create schema portal_private;

create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('t.uid',true),'')::uuid $$;
create table portal.staff_profiles(id uuid primary key, display_name text, role text not null default 'READ_ONLY', active boolean not null default false, version int not null default 1, updated_at timestamptz default now());
create function portal_private.guard() returns trigger language plpgsql as $$ begin
  NEW.version:=OLD.version+CASE WHEN (NEW.display_name,NEW.role,NEW.active) IS DISTINCT FROM (OLD.display_name,OLD.role,OLD.active) THEN 1 ELSE 0 END; return NEW; end $$;
create trigger v before update on portal.staff_profiles for each row execute function portal_private.guard();
create table portal.audit_logs(id uuid primary key default gen_random_uuid(), actor_id uuid, object_type text, object_id uuid, action text, safe_changes jsonb, request_id uuid);
create function portal_private.current_staff_role() returns text language sql as $$ select role from portal.staff_profiles where id=auth.uid() and active $$;
create function portal_private.staff_session_is_admitted(s uuid) returns boolean language sql as $$ select current_setting('t.admitted',true)='on' $$;
`);
  await db.exec(fn);
  const me = "00000000-0000-4000-8000-000000000001";
  const other = "00000000-0000-4000-8000-000000000002";
  const off = "00000000-0000-4000-8000-000000000003";
  await db.exec(`
insert into portal.staff_profiles(id,display_name,role,active) values
 ('${me}','Old Name','HR',true),('${other}','Colleague','ADMIN',true),('${off}','Inactive','HR',false);
`);
  const run = async (as, name, admitted = "on") => {
    await db.exec(
      `select set_config('t.uid','${as}',false); select set_config('t.admitted','${admitted}',false);
       select set_config('request.jwt.claims','{"session_id":"10000000-0000-4000-8000-000000000001"}',false);`,
    );
    return db.query("select portal_private.rename_own_profile($1) r", [name]);
  };

  const changed = (await run(me, "  New Name  ")).rows[0].r;
  assert.deepEqual(changed, { displayName: "New Name", version: 2 });
  assert.equal(
    (await db.query(`select display_name from portal.staff_profiles where id='${other}'`)).rows[0].display_name,
    "Colleague",
  );
  const audits = (await db.query("select actor_id,object_type,object_id,action,safe_changes from portal.audit_logs")).rows;
  assert.deepEqual(audits, [
    { actor_id: me, object_type: "STAFF_PROFILE", object_id: me, action: "STAFF_RENAMED", safe_changes: {} },
  ]);

  // Same name again: no new version, no new audit row.
  assert.deepEqual((await run(me, "New Name")).rows[0].r, { displayName: "New Name", version: 2 });
  assert.equal((await db.query("select count(*)::int n from portal.audit_logs")).rows[0].n, 1);

  for (const bad of ["", "   ", "x".repeat(101), "bad\u0007name", null])
    await assert.rejects(run(me, bad), (e) => e.code === "22023");
  await assert.rejects(run(off, "Whatever"), (e) => e.code === "42501");
  await assert.rejects(run(me, "Name", "off"), (e) => e.code === "42501");
  await assert.rejects(run("00000000-0000-4000-8000-0000000000ff", "Ghost"), (e) => e.code === "42501");
  await db.close();
});
