import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../auth/test-env.mjs";
let db;
let stage = "validate configuration";
try {
  if (process.argv.slice(2).some((v) => v !== "--apply")) throw new Error();
  const apply = process.argv.includes("--apply"),
    ref = loadAuthTestEnvironment();
  const files = [".env", ".env.test"].map((path) => ({
    path,
    text: readFileSync(path, "utf8"),
  }));
  const environments = files.map((file) => parse(file.text));
  for (const env of environments) {
    if (new URL(env.SUPABASE_URL).hostname !== `${ref}.supabase.co`)
      throw new Error();
    for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
      const url = new URL(env[key]);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        (url.hostname !== `db.${ref}.supabase.co` &&
          !(
            url.hostname.endsWith(".pooler.supabase.com") &&
            decodeURIComponent(url.username).endsWith(`.${ref}`)
          ))
      )
        throw new Error();
    }
    for (const key of ["AUTH_APP_ORIGIN", "PUBLIC_SITE_URL"]) {
      const url = new URL(env[key]);
      if (
        url.protocol !== "http:" ||
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== "/" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error();
    }
  }
  stage = "connect to the dedicated test project";
  db = await connectAuthTestDatabase(
    () =>
      new pg.Client({
        connectionString: process.env.DIRECT_URL,
        connectionTimeoutMillis: 15000,
        statement_timeout: 15000,
      }),
  );
  const ready = (
    await db.query(
      "SELECT to_regprocedure('portal_private.close_expired_jobs(integer,uuid)') IS NOT NULL AS ready",
    )
  ).rows[0].ready;
  if (!ready) throw new Error();
  if (!apply)
    console.log(
      "Dev/test project verified. Use --apply to provision the restricted expiry worker and local Cron secret.",
    );
  else {
    stage = "provision the restricted worker";
    const login = "portal_jobs_app";
    let connection =
      environments[1].JOBS_WORKER_DATABASE_URL ||
      environments[0].JOBS_WORKER_DATABASE_URL;
    let secret =
      environments[1].CRON_SECRET ||
      environments[0].CRON_SECRET ||
      randomBytes(36).toString("base64url");
    if (secret.length < 32 || /[\s\r\n]/.test(secret)) throw new Error();
    const exists = (
      await db.query(
        "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS present",
        [login],
      )
    ).rows[0].present;
    const url = new URL(connection || process.env.DIRECT_URL);
    if (connection) {
      const expected = url.hostname.endsWith(".pooler.supabase.com")
        ? `${login}.${ref}`
        : login;
      if (
        decodeURIComponent(url.username) !== expected ||
        (url.hostname !== `db.${ref}.supabase.co` &&
          !url.hostname.endsWith(".pooler.supabase.com"))
      )
        throw new Error();
    } else {
      if (exists) throw new Error(); // Never rotate an existing worker's password implicitly.
      url.username = url.hostname.endsWith(".pooler.supabase.com")
        ? `${login}.${ref}`
        : login;
      url.password = randomBytes(36).toString("base64url");
      connection = url.toString();
    }
    await db.query("BEGIN");
    if (!exists) {
      await db.query(
        `CREATE ROLE ${pg.escapeIdentifier(login)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${pg.escapeLiteral(decodeURIComponent(url.password))}`,
      );
      await db.query(
        `GRANT portal_jobs_worker TO ${pg.escapeIdentifier(login)}`,
      );
    }
    const {
      rows: [role],
    } = await db.query(
      `SELECT NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit) AND rolcanlogin AS restricted,
      (SELECT array_agg(parent.rolname::text ORDER BY parent.rolname) FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid WHERE m.member=r.oid) AS memberships FROM pg_roles r WHERE rolname=$1`,
      [login],
    );
    if (
      !role?.restricted ||
      JSON.stringify(role.memberships) !==
        JSON.stringify(["portal_jobs_worker"])
    )
      throw new Error();
    // Save only in ignored local env files; no generated credential is printed.
    for (const file of files) {
      let text = file.text;
      for (const [key, value] of Object.entries({
        JOBS_WORKER_DATABASE_URL: connection,
        CRON_SECRET: secret,
      })) {
        const line = `${key}=${JSON.stringify(value)}`,
          pattern = new RegExp(`^${key}=.*$`, "m");
        text = pattern.test(text)
          ? text.replace(pattern, () => line)
          : text.trimEnd() + "\n" + line + "\n";
      }
      writeFileSync(file.path, text);
    }
    await db.query("COMMIT");
    stage = "verify the worker connection";
    const worker = new pg.Client({
      connectionString: connection,
      connectionTimeoutMillis: 15000,
    });
    try {
      await worker.connect();
      await worker.query("BEGIN");
      await worker.query("SET LOCAL ROLE portal_jobs_worker");
      const {
        rows: [rights],
      } = await worker.query(
        "SELECT has_function_privilege(current_user,'portal_private.close_expired_jobs(integer,uuid)','EXECUTE') AS execute, has_table_privilege(current_user,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='portal' AND c.relname='jobs'),'SELECT,INSERT,UPDATE,DELETE') AS tables",
      );
      if (!rights.execute || rights.tables) throw new Error();
      await worker.query("ROLLBACK");
    } finally {
      await worker.end();
    }
    console.log(
      "Restricted expiry worker and Cron secret configured in .env and .env.test. Restart the dev server. No production settings were changed.",
    );
  }
} catch {
  if (db) await db.query("ROLLBACK").catch(() => {});
  console.error(
    `Jobs setup failed at: ${stage}. Check the guarded project, migration and existing credentials; no secrets are printed.`,
  );
  process.exitCode = 1;
} finally {
  if (db) await db.end();
}
