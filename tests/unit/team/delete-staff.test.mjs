import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "../../../prisma/migrations/20261116000100_staff_delete/migration.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
// Runs against a stub schema: the real audit-code wrapper and grants need the hosted project.
// Only the function body is exercised; the audit-code wrapper and grants need
// the real schema/roles.
const start = sql.indexOf("CREATE FUNCTION portal_private.delete_staff");
const end = sql.indexOf("REVOKE ALL ON FUNCTION");
const fn = sql.slice(start, end);

test("delete_staff refuses unsafe targets, cleans member-only rows, audits and replays", async () => {
  const db = new PGlite();
  await db.exec(`
create schema auth; create schema portal; create schema portal_private;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('t.uid',true),'')::uuid $$;
create table portal.staff_profiles(id uuid primary key, display_name text, role text not null default 'READ_ONLY', active boolean not null default false, version int not null default 1);
create table portal.audit_logs(id uuid primary key default gen_random_uuid(), actor_id uuid references portal.staff_profiles(id) on delete restrict, object_type text, object_id uuid, action text, safe_changes jsonb, request_id uuid);
create table portal.jobs(id serial primary key, owner_id uuid references portal.staff_profiles(id) on delete restrict);
create table portal_private.team_commands(request_id uuid primary key, actor_id uuid not null references portal.staff_profiles(id) on delete restrict, command jsonb not null, result jsonb not null);
create table portal_private.staff_session_cutoffs(profile_id uuid primary key references portal.staff_profiles(id) on delete restrict, revoked_before timestamptz not null);
create table portal_private.staff_provider_operations(id uuid primary key, profile_id uuid not null references portal.staff_profiles(id) on delete restrict, operation text, completed_at timestamptz);
create table portal_private.staff_invitation_requests(id uuid primary key, actor_id uuid not null references portal.staff_profiles(id) on delete restrict, email_hash bytea, profile_id uuid references portal.staff_profiles(id) on delete restrict);
create function portal_private.require_staff_admin() returns void language plpgsql as $$ begin if current_setting('t.admin',true) is distinct from 'on' then raise exception 'denied' using errcode='42501'; end if; end $$;
`);
  await db.exec(fn);

  const admin = "00000000-0000-4000-8000-000000000001";
  const inactive = "00000000-0000-4000-8000-000000000002";
  const active = "00000000-0000-4000-8000-000000000003";
  const worker = "00000000-0000-4000-8000-000000000004";
  const pending = "00000000-0000-4000-8000-000000000005";
  const req = (n) => `10000000-0000-4000-8000-00000000000${n}`;
  await db.exec(`
insert into portal.staff_profiles(id,display_name,role,active,version) values
 ('${admin}','Admin','ADMIN',true,1),
 ('${inactive}','Gone','HR',false,3),
 ('${active}','Still here','HR',true,1),
 ('${worker}','Has jobs','HR',false,2),
 ('${pending}','Pending sync','HR',false,2);
insert into portal.jobs(owner_id) values ('${worker}');
insert into portal_private.staff_session_cutoffs values ('${inactive}',now());
insert into portal_private.staff_provider_operations values ('20000000-0000-4000-8000-000000000001','${inactive}','ban',now());
insert into portal_private.staff_provider_operations values ('20000000-0000-4000-8000-000000000002','${pending}','ban',null);
insert into portal_private.staff_invitation_requests values ('30000000-0000-4000-8000-000000000001','${admin}','\\x00','${inactive}');
`);
  const run = async (id, version, r, as = admin, isAdmin = "on") => {
    await db.exec(
      `select set_config('t.uid','${as}',false); select set_config('t.admin','${isAdmin}',false);`,
    );
    return db.query(
      `select portal_private.delete_staff($1::uuid,$2,$3::uuid) r`,
      [id, version, r],
    );
  };
  const fails = async (promise, code) => {
    await assert.rejects(
      promise,
      (e) => e.code === code || String(e.message).includes(code),
      `expected ${code}`,
    );
  };

  await fails(run(inactive, 3, req(1), admin, "off"), "denied"); // not an admin
  await fails(run(admin, 1, req(2)), "Cannot delete own account");
  await fails(run(active, 1, req(3)), "Active member");
  await fails(run(inactive, 2, req(4)), "Stale staff profile"); // wrong version
  await fails(run(pending, 2, req(5)), "Provider reconciliation pending");
  await fails(run(worker, 2, req(6)), "violates foreign key"); // jobs reference them
  await fails(
    run("00000000-0000-4000-8000-0000000000ff", 1, req(7)),
    "Staff profile missing",
  );

  // The failed attempts left everything in place.
  assert.equal(
    (await db.query("select count(*)::int n from portal.staff_profiles"))
      .rows[0].n,
    5,
  );

  const ok = await run(inactive, 3, req(8));
  assert.deepEqual(ok.rows[0].r, { userId: inactive, deleted: true });
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from portal.staff_profiles where id=$1",
        [inactive],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from portal_private.staff_session_cutoffs",
      )
    ).rows[0].n,
    0,
  );
  const audit = (
    await db.query("select * from portal.audit_logs where object_id=$1", [
      inactive,
    ])
  ).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "STAFF_DELETED");
  assert.equal(audit[0].actor_id, admin);
  assert.deepEqual(audit[0].safe_changes, { role: "HR", active: false });

  // An identical replay returns the saved result instead of failing on the missing row.
  const replay = await run(inactive, 3, req(8));
  assert.deepEqual(replay.rows[0].r, { userId: inactive, deleted: true });
  // The same request id with a different body is a conflict.
  await fails(run(active, 1, req(8)), "Request conflict");
  await db.close();
});
