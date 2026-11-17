import "dotenv/config";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { authAdminClient } from "../../src/server/adapters/auth/admin.ts";
import { UUID } from "../../src/server/adapters/storage/cv-storage.ts";

const args = process.argv.slice(2);
let db: pg.Client | undefined;
try {
  if (
    args.length !== 2 ||
    !UUID.test(args[0]) ||
    !args[1].trim() ||
    args[1].trim().length > 100 ||
    !process.env.DIRECT_URL
  )
    throw new Error();
  const { data, error } = await authAdminClient().auth.admin.getUserById(
    args[0],
  );
  if (error || data.user?.id !== args[0]) throw new Error();
  db = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 15000,
  });
  await db.connect();
  await db.query("BEGIN");
  if (
    !(
      await db.query(
        "SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=$1::uuid) AS present",
        [args[0]],
      )
    ).rows[0].present
  )
    throw new Error();
  await db.query(
    "SELECT portal_private.bootstrap_staff_admin($1::uuid,$2,$3::uuid)",
    [args[0], args[1].trim(), randomUUID()],
  );
  await db.query("COMMIT");
  console.log(
    "First active administrator linked. No credential values were displayed.",
  );
} catch {
  await db?.query("ROLLBACK").catch(() => {});
  console.error(
    "Bootstrap failed. Usage: npm run auth:bootstrap -- <verified-user-UUID> <display-name>. Requires migration credentials, matching Auth identity and no existing active ADMIN.",
  );
  process.exitCode = 1;
} finally {
  await db?.end();
}
