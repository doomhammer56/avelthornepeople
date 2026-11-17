import { readFileSync, readdirSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const migration = (name) =>
  readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8");
const extract = (source, name) => {
  const match = source.match(
    new RegExp(
      `CREATE (?:OR REPLACE )?FUNCTION portal_private\\.${name}\\([\\s\\S]*?\\$\\$;`,
    ),
  );
  if (!match) throw new Error(`Missing function ${name}`);
  return match[0];
};
export async function privacyDatabase() {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE ROLE portal_runtime NOLOGIN; CREATE SCHEMA portal_private;`);
  for (const name of readdirSync("prisma/migrations")
    .filter((name) => name.startsWith("20261016"))
    .sort())
    await db.exec(migration(name));
  await db.exec(`GRANT USAGE ON SCHEMA portal,portal_private,auth TO portal_runtime;
    CREATE TABLE portal_private.staff_session_admissions(session_id uuid PRIMARY KEY,subject_id uuid NOT NULL);
    CREATE FUNCTION portal_private.staff_session_is_admitted(p_session uuid) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM portal_private.staff_session_admissions
        WHERE session_id=p_session AND subject_id=auth.uid()) $$;
    CREATE FUNCTION portal_private.current_staff_role() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
      SELECT role FROM portal.staff_profiles WHERE id=auth.uid() AND active
        AND portal_private.staff_session_is_admitted((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid) $$;
    GRANT SELECT ON ALL TABLES IN SCHEMA portal TO portal_runtime;
    CREATE POLICY staff_test ON portal.staff_profiles TO portal_runtime USING(id=auth.uid());
    CREATE POLICY candidate_test ON portal.candidates TO portal_runtime USING(portal_private.current_staff_role() IN('ADMIN','HR'));
    CREATE POLICY application_test ON portal.applications TO portal_runtime USING(intake_state='CONFIRMED' AND portal_private.current_staff_role() IN('ADMIN','HR'));
    CREATE POLICY request_test ON portal.deletion_requests TO portal_runtime USING(portal_private.current_staff_role()='ADMIN');
    CREATE POLICY upload_test ON portal.uploads TO portal_runtime USING(portal_private.current_staff_role() IN('ADMIN','HR') AND EXISTS(SELECT 1 FROM portal.applications a WHERE a.cv_upload_id=uploads.id));
    ALTER TABLE portal.uploads ADD COLUMN access_revoked_at timestamptz, ADD COLUMN provider_upload_expires_at timestamptz,
      ADD COLUMN intake_job_id uuid,ADD COLUMN intake_request_id uuid;`);
  await db.exec(migration("20261025000400_application_management"));
  await db.exec(migration("20261027000300_application_replay"));
  const audit = migration("20261026000100_administrative_audit");
  const codes = migration("20261026000200_audit_code_allowlist");
  await db.exec(`${extract(audit, "audit_payload_is_safe")}
    ${extract(codes, "audit_codes_are_safe")}
    ALTER TABLE portal.audit_logs ADD CONSTRAINT audit_logs_safe_payload CHECK(portal_private.audit_payload_is_safe(safe_changes));
    ALTER TABLE portal.audit_logs ADD CONSTRAINT audit_logs_codes CHECK(portal_private.audit_codes_are_safe(object_type,action));
    ${extract(codes, "guard_audit_record")}
    CREATE TRIGGER audit_record_guard BEFORE INSERT OR UPDATE ON portal.audit_logs FOR EACH ROW EXECUTE FUNCTION portal_private.guard_audit_record();`);
  await db.exec(migration("20261031000100_privacy_retention"));
  await db.exec(migration("20261102000100_privacy_dependency_permissions"));
  const actors = {};
  for (const role of ["ADMIN", "HR", "READ_ONLY"]) {
    const id = randomUUID(),
      session = randomUUID();
    await db.query("INSERT INTO auth.users VALUES($1)", [id]);
    await db.query(
      "INSERT INTO portal.staff_profiles(id,display_name,role,active) VALUES($1,'Privacy fixture',$2,true)",
      [id, role],
    );
    await db.query(
      "INSERT INTO portal_private.staff_session_admissions VALUES($1,$2)",
      [session, id],
    );
    actors[role] = { id, session };
  }
  const job = randomUUID();
  await db.query(
    "INSERT INTO portal.jobs(id,canonical_slug,draft_content,owner_id) VALUES($1,$2,'{}',$3)",
    [job, `privacy-${job}`, actors.ADMIN.id],
  );
  return { db, actors, job };
}
export async function actorContext(fixture, role = "ADMIN", admitted = true) {
  const actor = fixture.actors[role];
  await fixture.db.query(
    "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [
      actor.id,
      JSON.stringify({
        sub: actor.id,
        session_id: admitted ? actor.session : randomUUID(),
      }),
    ],
  );
}
export async function scoped(db, role, query, args = []) {
  await db.exec("SAVEPOINT scope");
  try {
    await db.exec(`SET LOCAL ROLE ${role}`);
    const result = await db.query(query, args);
    await db.exec("RESET ROLE; RELEASE SAVEPOINT scope");
    return result;
  } catch (error) {
    await db.exec("ROLLBACK TO SAVEPOINT scope; RELEASE SAVEPOINT scope");
    throw error;
  }
}
export async function command(
  f,
  kind,
  id,
  expected,
  body = {},
  request = randomUUID(),
) {
  if (kind === "policy") id = "00000000-0000-4000-8000-000000000001";
  return (
    await scoped(
      f.db,
      "portal_runtime",
      "SELECT portal_private.manage_privacy($1,$2,$3,$4,$5::jsonb) result",
      [kind, id, expected, request, JSON.stringify(body)],
    )
  ).rows[0].result;
}
export async function worker(f, name, args = []) {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(",");
  return (
    await scoped(
      f.db,
      "portal_privacy_worker",
      `SELECT portal_private.${name}(${placeholders}) result`,
      args,
    )
  ).rows[0].result;
}
export async function candidate(f, ageMonths = 0) {
  const id = randomUUID();
  await f.db.query(
    `INSERT INTO portal.candidates(id,name_encrypted,email_encrypted,phone_encrypted,email_hmac,phone_hmac,hmac_key_version,created_at)
    VALUES($1,'\\x01','\\x01','\\x01',$2,$3,1,now()-make_interval(months=>$4))`,
    [id, randomBytes(32), randomBytes(32), ageMonths],
  );
  return id;
}
export async function application(f, candidateId, monthsOld = 0, options = {}) {
  const id = randomUUID(),
    upload = randomUUID(),
    cap = randomBytes(32),
    request = randomUUID();
  const key = `${upload}/${randomUUID()}.pdf`;
  await f.db.query(
    `INSERT INTO portal.uploads(id,storage_provider,bucket,object_key,declared_size_bytes,size_bytes,detected_type,
    sha256,scan_state,scanned_at,capability_hash,capability_expires_at,created_at,provider_upload_expires_at,access_revoked_at,intake_job_id,intake_request_id)
    VALUES($1,'SUPABASE','cv-clean',$2,100,100,'application/pdf',$3,'CLEAN',now(),$4,now()+interval '1 day',
      now()-make_interval(months=>$5)-interval '1 day',now()+(CASE WHEN $6 THEN interval '2 hours' ELSE interval '-1 hour' END),
      CASE WHEN $7 THEN NULL ELSE now()-interval '10 minutes' END,$8,$9)`,
    [
      upload,
      key,
      randomBytes(32),
      cap,
      monthsOld,
      !!options.liveUploadToken,
      !!options.notRevoked,
      f.job,
      request,
    ],
  );
  await f.db.query(
    `INSERT INTO portal.applications(id,job_id,candidate_id,cv_upload_id,cv_scan_state,intake_state,profile_encrypted,
    consent_at,policy_version,source,locale,idempotency_key,payload_digest,receipt_hash,receipt_expires_at,submitted_at,confirmed_at)
    VALUES($1,$2,$3,$4,'CLEAN','CONFIRMED','\\x01',now(),'recruitment-24-months-v1','CAREERS','en',$5,$6,$7,
      now()+interval '1 day',now()-make_interval(months=>$8),now())`,
    [id, f.job, candidateId, upload, request, randomBytes(32), cap, monthsOld],
  );
  return { id, upload, cap, request, key };
}
export async function request(f, candidateId) {
  const id = randomUUID();
  await command(f, "request", id, null, {
    candidateId,
    requesterRef: randomUUID(),
  });
  return id;
}
