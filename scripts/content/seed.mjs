import "dotenv/config";
import { parseArgs } from "node:util";
import pg from "pg";
import { z } from "zod";
import { seedCompanyContent } from "./seed-data.mjs";
import { contentTypes } from "../../src/lib/content/contract.ts";
import { configureContentBucket } from "../../src/server/content/bucket.ts";
import { storageAdminClient } from "../../src/server/adapters/storage/config.ts";

let db;
try {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      "admin-id": { type: "string" },
      // Comma-separated block types (or "all") to rewrite with starter copy.
      replace: { type: "string" },
    },
  });
  const adminId = values["admin-id"]
    ? z.uuid().parse(values["admin-id"])
    : undefined;
  const replaceInput = (values.replace ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const replace = replaceInput.includes("ALL")
    ? [...contentTypes]
    : replaceInput;
  const unknown = replace.filter((type) => !contentTypes.includes(type));
  if (unknown.length)
    throw new Error(
      `Unknown --replace type: ${unknown.join(", ")}. Use ${contentTypes.join(", ")} or all.`,
    );
  const provider = new URL(process.env.SUPABASE_URL);
  const connection = new URL(process.env.DIRECT_URL);
  const ref = provider.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (
    !ref ||
    provider.protocol !== "https:" ||
    !["postgres:", "postgresql:"].includes(connection.protocol) ||
    !(
      connection.hostname === `db.${ref}.supabase.co` ||
      (connection.hostname.endsWith(".pooler.supabase.com") &&
        decodeURIComponent(connection.username).endsWith(`.${ref}`))
    )
  )
    throw new Error();
  db = new pg.Client({
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
  });
  await db.connect();
  await db.query("BEGIN");
  // Validate the database/admin and all publication inputs before Storage changes.
  const preview = await seedCompanyContent(db, { adminId, replace });
  console.log(`Company content target: ${provider.hostname}`);
  const bucket = await configureContentBucket(
    storageAdminClient(),
    values.apply,
  );
  if (values.apply && !bucket.configured) throw new Error();
  const results = values.apply
    ? await seedCompanyContent(db, { adminId, apply: true, replace })
    : preview;
  await db.query(values.apply ? "COMMIT" : "ROLLBACK");
  for (const row of results)
    console.log(
      `${row.type}: ${row.action}${row.legacy ? " (legacy demo copy detected)" : ""}`,
    );
  console.log(
    values.apply
      ? replace.length
        ? "Published starter content is ready. Sections not listed in --replace were preserved."
        : "Published starter content is ready. Existing edits/publications were preserved."
      : `Dry run; no changes. Private bucket configured: ${bucket.configured}. Add --apply to publish starter content.`,
  );
} catch (error) {
  if (db) await db.query("ROLLBACK").catch(() => {});
  console.error(
    error?.message?.startsWith("Specify --admin-id") ||
      error?.message?.startsWith("Unknown --replace")
      ? error.message
      : "Content seed failed or its response was interrupted. Check deployed migrations, matching DIRECT_URL/SUPABASE credentials, active ADMIN and current publications before retrying.",
  );
  process.exitCode = 1;
} finally {
  if (db) await db.end();
}
