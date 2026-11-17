import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

// Called only after loadAuthTestEnvironment and the content-suite advisory lock.
// The explicit opt-in permits temporary slot isolation in an already seeded QA
// project. Original content is never edited, published, or deleted by the test.
export async function parkContentSlots(db, parked = { rows: [] }) {
  await db.query("BEGIN");
  let backupPath;
  try {
    const rows = (
      await db.query(`SELECT to_jsonb(c) original,
      EXISTS(SELECT 1 FROM portal.audit_logs a WHERE a.object_id=c.id
        AND a.action='CONTENT_TEMPLATE_CREATED') template
      FROM portal.content_blocks c WHERE slot IS NOT NULL FOR UPDATE`)
    ).rows;
    assert.ok(
      process.env.CONTENT_E2E_PARK_MANAGED === "1" ||
        rows.every(
          ({ original, template }) =>
            template &&
            original.version === 1 &&
            original.published_content === null,
        ),
      "Use isolated test content slots; edited/published content will not be replaced",
    );
    if (rows.length) {
      mkdirSync(".cache/qa01", { recursive: true });
      backupPath = resolve(`.cache/qa01/content-slots-${randomUUID()}.json`);
      writeFileSync(
        backupPath,
        JSON.stringify(
          {
            project: process.env.AUTH_TEST_PROJECT_REF,
            rows: rows.map(({ original }) => original),
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
      // Publish recovery information before the first mutation, including when
      // a connection failure makes the COMMIT acknowledgement ambiguous.
      parked.rows = rows.map(({ original }) => original);
      parked.backupPath = backupPath;
      await db.query(
        "UPDATE portal.content_blocks SET slot=NULL WHERE id=ANY($1::uuid[])",
        [rows.map(({ original }) => original.id)],
      );
    }
    await db.query("COMMIT");
    return parked;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

// Runs in the fixture-cleanup transaction. Verify originals were not changed by
// another writer, then restore slots AND precise original update timestamps.
export async function restoreContentSlots(db, parked) {
  if (!parked.rows.length) return;
  await db.query(
    "ALTER TABLE portal.content_blocks DISABLE TRIGGER touch_updated_at",
  );
  for (const original of parked.rows) {
    const restored = await db.query(
      `UPDATE portal.content_blocks c
      SET slot=$2,updated_at=$3::timestamptz
      WHERE id=$1 AND (slot IS NULL OR slot=$2)
        AND (to_jsonb(c)-'slot'-'updated_at')=($4::jsonb-'slot'-'updated_at')
      RETURNING to_jsonb(c) original`,
      [
        original.id,
        original.slot,
        original.updated_at,
        JSON.stringify(original),
      ],
    );
    assert.equal(
      restored.rowCount,
      1,
      `Original content changed; recovery backup: ${parked.backupPath}`,
    );
    assert.deepEqual(restored.rows[0].original, original);
  }
  await db.query(
    "ALTER TABLE portal.content_blocks ENABLE TRIGGER touch_updated_at",
  );
}

export function removeContentSlotBackup(parked) {
  if (parked.backupPath) unlinkSync(parked.backupPath);
}
