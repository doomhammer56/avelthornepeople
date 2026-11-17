import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../auth/test-env.mjs";
import { seedLocalJob } from "./seed-local.mjs";

const args = process.argv.slice(2);
let db;
let stage = "validate configuration";
try {
  if (
    args.some((arg) => !["--apply", "--seed"].includes(arg)) ||
    (args.includes("--seed") && !args.includes("--apply"))
  )
    throw new Error();
  const apply = args.includes("--apply");
  const devText = readFileSync(".env", "utf8"),
    testText = readFileSync(".env.test", "utf8");
  const dev = parse(devText),
    test = parse(testText);
  const ref = loadAuthTestEnvironment();
  if (new URL(dev.SUPABASE_URL).hostname !== `${ref}.supabase.co`)
    throw new Error("Dev must use the guarded test project");
  for (const env of [dev, test]) {
    for (const key of ["AUTH_APP_ORIGIN", "PUBLIC_SITE_URL"]) {
      if (env[key]) {
        const origin = new URL(env[key]);
        if (
          origin.protocol !== "http:" ||
          !["localhost", "127.0.0.1"].includes(origin.hostname) ||
          origin.pathname !== "/" ||
          origin.search ||
          origin.hash ||
          origin.username ||
          origin.password
        )
          throw new Error("Loopback origins required");
      }
    }
    const url = new URL(env.DIRECT_URL);
    if (
      url.hostname !== `db.${ref}.supabase.co` &&
      !(
        url.hostname.endsWith(".pooler.supabase.com") &&
        decodeURIComponent(url.username).endsWith(`.${ref}`)
      )
    )
      throw new Error("Operator connections must match the test project");
  }
  stage = "connect to the dedicated test database";
  db = await connectAuthTestDatabase(
    () =>
      new pg.Client({
        connectionString: test.DIRECT_URL,
        connectionTimeoutMillis: 15000,
        statement_timeout: 15000,
      }),
  );
  if (
    !(
      await db.query(
        "SELECT to_regprocedure('portal_private.record_job_detail_view(uuid,text,text,uuid)') IS NOT NULL AS ready",
      )
    ).rows[0].ready
  )
    throw new Error("Deploy the dashboard migration first");
  if (!apply) {
    console.log(
      "Dedicated dev/test configuration verified. Use --apply to provision restricted logins and enable tracking; add --seed for the labelled development vacancy.",
    );
  } else {
    stage = "provision restricted logins";
    const values = {};
    await db.query("BEGIN");
    for (const [key, login, capability] of [
      [
        "ANALYTICS_DATABASE_URL",
        "portal_analytics_app",
        "portal_metrics_writer",
      ],
      ["PUBLIC_DATABASE_URL", "portal_web_reader", "portal_public_reader"],
    ]) {
      let connection = test[key] || dev[key];
      const exists = (
        await db.query(
          "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1) AS present",
          [login],
        )
      ).rows[0].present;
      if (connection) {
        const url = new URL(connection);
        const expected = url.hostname.endsWith(".pooler.supabase.com")
          ? `${login}.${ref}`
          : login;
        if (
          decodeURIComponent(url.username) !== expected ||
          (url.hostname !== `db.${ref}.supabase.co` &&
            !url.hostname.endsWith(".pooler.supabase.com"))
        )
          throw new Error(
            "Existing connection does not match the dedicated role",
          );
      }
      if (!exists) {
        const url = connection ? new URL(connection) : new URL(test.DIRECT_URL);
        if (!connection) {
          url.username = url.hostname.endsWith(".pooler.supabase.com")
            ? `${login}.${ref}`
            : login;
          url.password = randomBytes(36).toString("base64url");
        }
        await db.query(
          `CREATE ROLE ${pg.escapeIdentifier(login)} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${pg.escapeLiteral(decodeURIComponent(url.password))}`,
        );
        await db.query(
          `GRANT ${pg.escapeIdentifier(capability)} TO ${pg.escapeIdentifier(login)}`,
        );
        connection = url.toString();
      } else if (!connection)
        throw new Error(
          "Existing login has no local credential; restore it explicitly instead of rotating its password",
        );
      const {
        rows: [role],
      } = await db.query(
        `SELECT NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit) AND rolcanlogin AS restricted,
        (SELECT array_agg(parent.rolname::text ORDER BY parent.rolname) FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid WHERE m.member=r.oid) AS memberships
        FROM pg_roles r WHERE rolname=$1`,
        [login],
      );
      if (
        !role?.restricted ||
        JSON.stringify(role.memberships) !== JSON.stringify([capability])
      )
        throw new Error("Existing login has unexpected privileges");
      values[key] = connection;
    }
    // Persist credentials in ignored local files before committing. If commit
    // fails, a rerun can recreate absent roles with these same saved passwords.
    const update = (text, entries) => {
      for (const [key, value] of Object.entries(entries)) {
        const line = `${key}=${JSON.stringify(value)}`;
        const expression = new RegExp(`^${key}=.*$`, "m");
        text = expression.test(text)
          ? text.replace(expression, () => line)
          : text.trimEnd() + "\n" + line + "\n";
      }
      return text;
    };
    const common = {
      ...values,
      PUBLIC_JOBS_SOURCE: "database",
      AUTH_TRUSTED_IP_HEADER: "",
    };
    writeFileSync(
      ".env",
      update(devText, {
        ...common,
        AUTH_APP_ORIGIN: "http://localhost:3000",
        PUBLIC_SITE_URL: "http://localhost:3000",
      }),
    );
    writeFileSync(
      ".env.test",
      update(testText, {
        ...common,
        AUTH_APP_ORIGIN: "http://127.0.0.1:3000",
        PUBLIC_SITE_URL: "http://127.0.0.1:3000",
      }),
    );
    await db.query("COMMIT");
    stage = "verify restricted connections";
    for (const [key, capability] of [
      ["ANALYTICS_DATABASE_URL", "portal_metrics_writer"],
      ["PUBLIC_DATABASE_URL", "portal_public_reader"],
    ]) {
      const client = await connectAuthTestDatabase(
        () =>
          new pg.Client({
            connectionString: values[key],
            connectionTimeoutMillis: 15000,
            statement_timeout: 10000,
          }),
      );
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL ROLE ${pg.escapeIdentifier(capability)}`);
        if (key === "PUBLIC_DATABASE_URL")
          await client.query("SELECT id FROM portal.visible_jobs LIMIT 1");
        else if (
          !(
            await client.query(
              "SELECT has_function_privilege(current_user,'portal_private.record_job_detail_view(uuid,text,text,uuid)','EXECUTE') AS allowed",
            )
          ).rows[0].allowed
        )
          throw new Error();
        await client.query("ROLLBACK");
      } finally {
        await client.end();
      }
    }
    stage = "enable tracking and seed development data";
    await db.query("BEGIN");
    const slug = args.includes("--seed") ? await seedLocalJob(db) : null;
    const {
      rows: [state],
    } = await db.query(
      "UPDATE portal_private.analytics_state SET started_at=COALESCE(started_at,statement_timestamp()) WHERE singleton RETURNING started_at",
    );
    await db.query("COMMIT");
    console.log(
      "Restricted writer and reader verified; .env and .env.test configured. No credentials displayed.",
    );
    console.log(
      `Tracking enabled from ${new Date(state.started_at).toISOString()} (existing start preserved).`,
    );
    if (slug)
      console.log(
        `Development seed: http://localhost:3000/en/jobs/${slug} (test server: http://127.0.0.1:3000/en/jobs/${slug}).`,
      );
  }
} catch (error) {
  await db?.query("ROLLBACK").catch(() => {});
  console.error(
    `Local PV setup could not ${stage}${error?.code ? ` (${error.code})` : ""}. No credentials were printed. Check the guarded configuration; existing passwords are never rotated.`,
  );
  process.exitCode = 1;
} finally {
  await db?.end();
}
