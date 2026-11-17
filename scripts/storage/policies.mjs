import "dotenv/config";
import { readFileSync } from "node:fs";
import pg from "pg";

const db = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  connectionTimeoutMillis: 15000,
  statement_timeout: 15000,
});
try {
  if (!process.env.DIRECT_URL) throw new Error("DIRECT_URL is required.");
  await db.connect();
  const sql = readFileSync(
    new URL(
      "../../supabase/storage/001_private_cv_policies.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.query(sql);
  console.log(
    "CV-specific Storage guards applied. Other bucket policies are unchanged.",
  );
} catch (error) {
  console.error(
    error?.code === "42501"
      ? "Storage policy ownership is required. Run supabase/storage/001_private_cv_policies.sql in the Supabase SQL editor as the authorized Storage owner."
      : "Storage policy deployment failed. Check DIRECT_URL and Storage availability.",
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
