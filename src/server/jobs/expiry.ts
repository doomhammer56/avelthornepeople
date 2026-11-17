import "server-only";
import pg from "pg";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StaffAuthError } from "../auth/errors.ts";
import { createDatabasePool } from "../database/pool.ts";
let pool: pg.Pool | undefined;
export function authorizeJobCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) throw new StaffAuthError(503);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new StaffAuthError(401);
}
function jobsWorkerPool() {
  if (!process.env.JOBS_WORKER_DATABASE_URL) throw new StaffAuthError(503);
  pool ??= createDatabasePool("jobs-worker", {
    connectionString: process.env.JOBS_WORKER_DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
  });
  return pool;
}
export async function closeExpiredJobs(connectionPool = jobsWorkerPool()) {
  const started = Date.now(),
    requestId = randomUUID();
  let processed = 0,
    remaining = false,
    batches = 0;
  const db = await connectionPool.connect();
  try {
    const {
      rows: [role],
    } =
      await db.query(`SELECT NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolinherit) AS restricted,
      (SELECT array_agg(parent.rolname::text ORDER BY parent.rolname) FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid WHERE m.member=r.oid) AS memberships
      FROM pg_roles r WHERE r.rolname=session_user`);
    if (
      !role?.restricted ||
      JSON.stringify(role.memberships) !==
        JSON.stringify(["portal_jobs_worker"])
    )
      throw new StaffAuthError(503);
    do {
      try {
        await db.query("BEGIN; SET LOCAL ROLE portal_jobs_worker;");
        const {
          rows: [result],
        } = await db.query(
          "SELECT * FROM portal_private.close_expired_jobs(100,$1::uuid)",
          [requestId],
        );
        await db.query("COMMIT");
        processed += result.processed;
        remaining = result.remaining;
        batches++;
        // A locked backlog belongs to another transaction. Leave it retryable
        // instead of spending the run budget polling rows we cannot lock.
        if (result.processed === 0) break;
      } catch (error) {
        await db.query("ROLLBACK").catch(() => {});
        throw error;
      }
    } while (remaining && batches < 10 && Date.now() - started < 15000);
    return {
      processed,
      remaining,
      batches,
      durationMs: Date.now() - started,
      requestId,
    };
  } finally {
    db.release();
  }
}
