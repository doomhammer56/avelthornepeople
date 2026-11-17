import "server-only";
import pg from "pg";
import { StaffAuthError } from "../auth/errors.ts";
import type { TrafficSource } from "./source.ts";
import { createDatabasePool } from "../database/pool.ts";

let pool: pg.Pool | undefined;
function analyticsPool() {
  if (!process.env.ANALYTICS_DATABASE_URL) throw new StaffAuthError(503);
  pool ??= createDatabasePool("analytics", {
    connectionString: process.env.ANALYTICS_DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
  });
  return pool;
}
export async function incrementDetailView(
  jobId: string,
  locale: string,
  source: TrafficSource,
  key: string,
  connectionPool = analyticsPool(),
) {
  const db = await connectionPool.connect();
  let contextReady = false;
  try {
    const setup = await db.query(`BEGIN;
      SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb) AS restricted,
      pg_has_role(session_user,'portal_metrics_writer','MEMBER') AS writer,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('portal','portal_private') AND c.relkind IN ('r','v')
        AND pg_has_role(session_user,c.relowner,'MEMBER')) AS owner_member,
      pg_has_role(session_user,'portal_runtime','MEMBER') OR pg_has_role(session_user,'portal_public_reader','MEMBER')
        OR pg_has_role(session_user,'portal_metrics_owner','MEMBER') AS mixed
      FROM pg_roles r WHERE rolname=session_user;
      SET LOCAL ROLE portal_metrics_writer;`);
    const role =
      Array.isArray(setup) && setup.length === 3
        ? setup[1]?.rows?.[0]
        : undefined;
    if (!role?.restricted || !role.writer || role.owner_member || role.mixed)
      throw new StaffAuthError(503);
    contextReady = true;
    const {
      rows: [row],
    } = await db.query(
      "SELECT portal_private.record_job_detail_view($1::uuid,$2,$3,$4::uuid) AS retry",
      [jobId, locale, source, key],
    );
    await db.query("COMMIT");
    return Number(row.retry);
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    if (
      !contextReady &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42501"
    )
      throw new StaffAuthError(503);
    throw error;
  } finally {
    db.release();
  }
}
