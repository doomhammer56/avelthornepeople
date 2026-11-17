import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../auth/test-env.mjs";
import { storageAdminClient } from "../../src/server/adapters/storage/config.ts";
import { configureContentBucket } from "../../src/server/content/bucket.ts";
import { contentTemplates } from "./templates.ts";
import { contentDraft, contentIssues } from "../../src/lib/content/contract.ts";
let db;
try {
  if (process.argv.slice(2).some((v) => v !== "--apply")) throw new Error();
  const apply = process.argv.includes("--apply"),
    ref = loadAuthTestEnvironment();
  for (const file of [".env", ".env.test"]) {
    const env = parse(readFileSync(file));
    if (new URL(env.SUPABASE_URL).hostname !== `${ref}.supabase.co`)
      throw new Error();
    for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
      const url = new URL(env[name]);
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        (url.hostname !== `db.${ref}.supabase.co` &&
          !(
            url.hostname.endsWith(".pooler.supabase.com") &&
            decodeURIComponent(url.username).endsWith(`.${ref}`)
          ))
      )
        throw new Error();
    }
    for (const name of ["AUTH_APP_ORIGIN", "PUBLIC_SITE_URL"]) {
      const url = new URL(env[name]);
      if (
        url.protocol !== "http:" ||
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw new Error();
    }
  }
  db = await connectAuthTestDatabase(
    () =>
      new pg.Client({
        connectionString: process.env.DIRECT_URL,
        connectionTimeoutMillis: 15000,
        statement_timeout: 15000,
      }),
  );
  if (
    !(
      await db.query(
        "SELECT to_regprocedure('portal_private.manage_content(text,uuid,integer,uuid,text,jsonb,integer,boolean)') IS NOT NULL ready",
      )
    ).rows[0].ready
  )
    throw new Error();
  const bucket = await configureContentBucket(storageAdminClient(), apply);
  if (!apply) {
    console.log(
      `Dev/test verified. Private content bucket configured: ${bucket.configured}. Use --apply to configure it and import six draft templates.`,
    );
  } else {
    if (!bucket.configured) throw new Error();
    await db.query("BEGIN");
    let created = 0;
    for (const template of contentTemplates()) {
      const draft = contentDraft.parse(template.draft);
      if (contentIssues(template.type, draft).length) throw new Error();
      const id = randomUUID();
      const result = await db.query(
        "INSERT INTO portal.content_blocks(id,type,slot,sort_order,draft_content) VALUES($1,$2,lower($2),$3,$4) ON CONFLICT(slot) DO NOTHING RETURNING id",
        [id, template.type, template.sortOrder, JSON.stringify(draft)],
      );
      if (result.rowCount) {
        created++;
        await db.query(
          "INSERT INTO portal.audit_logs(object_type,object_id,action,safe_changes,request_id) VALUES('CONTENT',$1,'CONTENT_TEMPLATE_CREATED',$2,$1)",
          [id, JSON.stringify({ id, version: 1 })],
        );
        await db.query(
          "INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references) VALUES('CONTENT_TEMPLATE_CREATED',$1,$2,$3)",
          [id, `content-template:${id}`, JSON.stringify({ id, version: 1 })],
        );
      }
    }
    await db.query("COMMIT");
    console.log(
      `Private content bucket configured; ${created} new draft templates imported. Existing blocks are preserved. No templates were published.`,
    );
  }
} catch {
  if (db) await db.query("ROLLBACK").catch(() => {});
  console.error(
    "Content setup refused or failed. Verify matching dedicated local environments, deployed migration and Storage access. No production setup is supported by this command.",
  );
  process.exitCode = 1;
} finally {
  if (db) await db.end();
}
