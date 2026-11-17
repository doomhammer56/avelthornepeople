import "server-only";
import pg from "pg";
import { verifiedDatabaseConfig } from "./tls.ts";

type DatabasePoolName =
  "runtime" | "public" | "analytics" | "jobs-worker" | "privacy-worker";

// Idle clients emit outside a request's try/catch. The pool discards the failed
// client itself; handle the event so a background disconnect cannot crash Node.
export function createDatabasePool(
  name: DatabasePoolName,
  config: pg.PoolConfig,
) {
  const pool = new pg.Pool(verifiedDatabaseConfig(config));
  pool.on("error", (error: Error & { code?: unknown }) => {
    const code =
      typeof error.code === "string" &&
      (/^[0-9A-Z]{5}$/.test(error.code) ||
        [
          "ECONNRESET",
          "ECONNREFUSED",
          "ETIMEDOUT",
          "ENOTFOUND",
          "EPIPE",
        ].includes(error.code))
        ? error.code
        : "UNKNOWN";
    // Error messages, detail fields and client objects can contain credentials
    // or SQL values. Only emit the fixed pool label and a bounded error code.
    console.error("database_pool_error", { pool: name, code });
  });
  return pool;
}
