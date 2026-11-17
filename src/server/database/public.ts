import "server-only";
import pg from "pg";
import { createDatabasePool } from "./pool.ts";

let pool: pg.Pool | undefined;

function publicReaderPool() {
  if (!process.env.PUBLIC_DATABASE_URL)
    throw new Error("Public database unavailable");
  pool ??= createDatabasePool("public", {
    connectionString: process.env.PUBLIC_DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    statement_timeout: 8000,
  });
  return pool;
}

// Public reads have their own login and can select only the public RLS views.
export async function withPublicReader<T>(
  action: (db: pg.PoolClient) => Promise<T>,
  connectionPool = publicReaderPool(),
): Promise<T> {
  const db = await connectionPool.connect();
  try {
    const setup = await db.query(`BEGIN READ ONLY;
      SELECT
      NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb) AS restricted,
      pg_has_role(session_user,'portal_public_reader','MEMBER') AS reader,
      EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('portal','portal_private') AND c.relkind IN ('r','v')
        AND pg_has_role(session_user,c.relowner,'MEMBER')) AS owner_member,
      pg_has_role(session_user,'portal_runtime','MEMBER') OR pg_has_role(session_user,'portal_metrics_writer','MEMBER')
        OR pg_has_role(session_user,'portal_public_view_owner','MEMBER') AS mixed
      FROM pg_roles r WHERE rolname=session_user;
      SET LOCAL ROLE portal_public_reader;`);
    const role =
      Array.isArray(setup) && setup.length === 3
        ? setup[1]?.rows?.[0]
        : undefined;
    if (!role?.restricted || !role.reader || role.owner_member || role.mixed)
      throw new Error("Public database unavailable");
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
