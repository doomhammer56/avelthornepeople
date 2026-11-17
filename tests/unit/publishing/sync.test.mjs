import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { assertPublicationSync } from "../../helpers/publishing-sync.mjs";
import {
  parkContentSlots,
  restoreContentSlots,
  removeContentSlotBackup,
} from "../../helpers/content-slots.mjs";

async function serverFor(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test("publication checks independently retry stale API and language responses", async (t) => {
  const hits = new Map(),
    diagnostics = [];
  const origin = await serverFor(t, (request, response) => {
    const count = (hits.get(request.url) ?? 0) + 1;
    hits.set(request.url, count);
    response.end(JSON.stringify({ revision: count > 1 ? 2 : 1 }));
  });
  await assertPublicationSync(
    { diagnostic: (value) => diagnostics.push(value) },
    origin,
    "publish",
    performance.now(),
    ["/api", "/en", "/zh"].map((path) => ({
      path,
      matches: async (response) => (await response.json()).revision === 2,
    })),
    { budgetMs: 1000, pollMs: 1 },
  );
  assert.equal(diagnostics.length, 3);
  assert.ok([...hits.values()].every((count) => count >= 2));
});

test("a matching response completed after the deadline cannot pass", async (t) => {
  const origin = await serverFor(t, (_request, response) =>
    response.end("ready"),
  );
  await assert.rejects(
    assertPublicationSync(
      t,
      origin,
      "late",
      performance.now(),
      [
        {
          path: "/",
          matches: async (response) => {
            await response.text();
            await setTimeout(100);
            return true;
          },
        },
      ],
      { budgetMs: 50, pollMs: 1 },
    ),
    AggregateError,
  );
});

test("the budget starts at acknowledgement rather than at the first probe", async (t) => {
  let requests = 0;
  const origin = await serverFor(t, (_request, response) => {
    requests++;
    response.end("ready");
  });
  await assert.rejects(
    assertPublicationSync(
      t,
      origin,
      "expired",
      performance.now() - 100,
      [{ path: "/", matches: async () => true }],
      { budgetMs: 50 },
    ),
    AggregateError,
  );
  assert.equal(requests, 0);
});

test("managed QA slots require opt-in, restore exact rows, and preserve concurrent edits", async (t) => {
  const previous = process.env.CONTENT_E2E_PARK_MANAGED;
  const db = new PGlite();
  const backups = [];
  t.after(async () => {
    if (previous === undefined) delete process.env.CONTENT_E2E_PARK_MANAGED;
    else process.env.CONTENT_E2E_PARK_MANAGED = previous;
    for (const backup of backups)
      if (existsSync(backup.backupPath)) removeContentSlotBackup(backup);
    await db.close();
  });
  const connection = {
    query: async (...args) => {
      const result = await db.query(...args);
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    },
  };
  await db.exec(`CREATE SCHEMA portal;
    CREATE TABLE portal.content_blocks(id uuid PRIMARY KEY,slot text UNIQUE,version int,published_content jsonb,updated_at timestamptz DEFAULT now());
    CREATE TABLE portal.audit_logs(object_id uuid,action text);
    CREATE FUNCTION portal.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
    CREATE TRIGGER touch_updated_at BEFORE UPDATE ON portal.content_blocks FOR EACH ROW EXECUTE FUNCTION portal.touch_updated_at();`);
  const id = randomUUID();
  await db.query(
    "INSERT INTO portal.content_blocks(id,slot,version,published_content) VALUES($1,'banner',4,'{\"title\":\"Original\"}')",
    [id],
  );
  const original = (
    await db.query("SELECT to_jsonb(c) original FROM portal.content_blocks c")
  ).rows[0].original;
  delete process.env.CONTENT_E2E_PARK_MANAGED;
  await assert.rejects(
    parkContentSlots(connection),
    /Use isolated test content slots/,
  );
  assert.deepEqual(
    (await db.query("SELECT to_jsonb(c) original FROM portal.content_blocks c"))
      .rows[0].original,
    original,
  );

  process.env.CONTENT_E2E_PARK_MANAGED = "1";
  const parked = { rows: [] };
  await parkContentSlots(connection, parked);
  backups.push(parked);
  assert.ok(existsSync(parked.backupPath));
  assert.equal(
    (await db.query("SELECT slot FROM portal.content_blocks")).rows[0].slot,
    null,
  );
  await db.query("BEGIN");
  await restoreContentSlots(connection, parked);
  await db.query("COMMIT");
  assert.deepEqual(
    (await db.query("SELECT to_jsonb(c) original FROM portal.content_blocks c"))
      .rows[0].original,
    original,
  );
  removeContentSlotBackup(parked);

  const changed = await parkContentSlots(connection);
  backups.push(changed);
  await db.query(
    "UPDATE portal.content_blocks SET version=version+1 WHERE id=$1",
    [id],
  );
  await db.query("BEGIN");
  await assert.rejects(
    restoreContentSlots(connection, changed),
    /Original content changed/,
  );
  await db.query("ROLLBACK");
  const row = (await db.query("SELECT slot,version FROM portal.content_blocks"))
    .rows[0];
  assert.deepEqual(row, { slot: null, version: 5 });
  assert.ok(existsSync(changed.backupPath));
});
