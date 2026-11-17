import "server-only";
import pg from "pg";
import { StaffAuthError } from "../auth/errors.ts";
import { createDatabasePool } from "./pool.ts";
import { measureAdminPhase } from "../admin/timing.ts";

let pool: pg.Pool | undefined;
export function runtimePool() {
  if (!process.env.DATABASE_URL) throw new StaffAuthError(503);
  return (pool ??= createDatabasePool("runtime", {
    connectionString: process.env.DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
  }));
}

export async function withRuntime<T>(
  subject: string | null,
  action: (db: pg.PoolClient) => Promise<T>,
  connectionPool = runtimePool(),
  sessionId?: string,
) {
  const db = await measureAdminPhase("db_pool", () => connectionPool.connect());
  let contextReady = false;
  try {
    // Only constant SQL is batched. No business query or request value runs
    // until the session-user role checks below have passed.
    const setup = await measureAdminPhase("db_setup", () =>
      db.query(`BEGIN;
      SELECT
      NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb) AS restricted,
      pg_has_role(session_user, 'portal_runtime', 'MEMBER') AS runtime_member,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('portal','portal_private') AND c.relkind IN ('r','v')
        AND pg_has_role(session_user,c.relowner,'MEMBER')) AS owner_member
      FROM pg_roles r WHERE r.rolname=session_user;
      SET LOCAL ROLE portal_runtime;`),
    );
    const role =
      Array.isArray(setup) && setup.length === 3
        ? setup[1]?.rows?.[0]
        : undefined;
    if (!role?.restricted || !role.runtime_member || role.owner_member)
      throw new StaffAuthError(503);
    await measureAdminPhase("db_setup", () =>
      db.query(
        "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
        [
          subject ?? "",
          JSON.stringify({
            ...(subject ? { sub: subject } : {}),
            ...(sessionId ? { session_id: sessionId } : {}),
          }),
        ],
      ),
    );
    contextReady = true;
    const result = await measureAdminPhase("db_work", () => action(db));
    await db.query("COMMIT");
    return result;
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
