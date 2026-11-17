import "server-only";
import type pg from "pg";
import { createDatabasePool } from "../database/pool.ts";
import { StaffAuthError } from "../auth/errors.ts";

let pool: pg.Pool | undefined;
function privacyWorkerPool() {
  if (!process.env.PRIVACY_WORKER_DATABASE_URL) throw new StaffAuthError(503);
  return (pool ??= createDatabasePool("privacy-worker", {
    connectionString: process.env.PRIVACY_WORKER_DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
  }));
}
export async function withPrivacyWorker<T>(
  action: (db: pg.PoolClient) => Promise<T>,
  connectionPool = privacyWorkerPool(),
) {
  const db = await connectionPool.connect();
  try {
    const {
      rows: [role],
    } = await db.query(`SELECT
      NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolinherit) AS restricted,
      (SELECT array_agg(parent.rolname::text ORDER BY parent.rolname) FROM pg_auth_members m
        JOIN pg_roles parent ON parent.oid=m.roleid WHERE m.member=r.oid) memberships
      FROM pg_roles r WHERE r.rolname=session_user`);
    if (
      !role?.restricted ||
      JSON.stringify(role.memberships) !==
        JSON.stringify(["portal_privacy_worker"])
    )
      throw new StaffAuthError(503);
    await db.query("BEGIN; SET LOCAL ROLE portal_privacy_worker;");
    const result = await action(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
