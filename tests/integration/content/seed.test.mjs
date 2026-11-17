import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
import { createStaffFixture } from "../database/helpers.mjs";
import { seedCompanyContent } from "../../../scripts/content/seed-data.mjs";
loadAuthTestEnvironment();

test(
  "Published content bootstrap preserves managed content and is safe to rerun",
  { timeout: 180000 },
  async (t) => {
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client({
          connectionString: process.env.DIRECT_URL,
          connectionTimeoutMillis: 15000,
          statement_timeout: 15000,
        }),
    );
    t.after(async () => {
      await db.query("ROLLBACK").catch(() => {});
      await db.end();
    });
    await db.query("BEGIN");
    const adminId = await createStaffFixture(db);
    await db.query(
      "UPDATE portal.staff_profiles SET role='ADMIN',active=true WHERE id=$1",
      [adminId],
    );
    await db.query(
      "UPDATE portal.content_blocks SET slot=NULL WHERE slot IS NOT NULL",
    );
    const seed = (apply = true) => seedCompanyContent(db, { adminId, apply });
    const rows = async () =>
      (
        await db.query(
          "SELECT id,type,version,draft_content,published_content,published_version,published_at,updated_at FROM portal.content_blocks WHERE slot IS NOT NULL ORDER BY type",
        )
      ).rows;

    await t.test("dry run leaves all slots empty", async () => {
      assert.equal(
        (await seed(false)).filter((r) => r.action === "create-published")
          .length,
        6,
      );
      assert.equal((await rows()).length, 0);
    });
    await t.test(
      "creates six live bilingual sections with audit/outbox in the same transaction",
      async () => {
        assert.equal(
          (await seed()).filter((r) => r.action === "create-published").length,
          6,
        );
        const content = await rows();
        assert.equal(content.length, 6);
        for (const row of content) {
          assert.equal(row.published_version, 1);
          assert.ok(
            row.published_content.en.title && row.published_content.zh.title,
          );
          assert.equal(row.published_content.englishFallback, false);
        }
        await db.query("GRANT portal_public_reader TO CURRENT_USER");
        await db.query("SET LOCAL ROLE portal_public_reader");
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::integer n FROM portal.company_content",
            )
          ).rows[0].n,
          6,
        );
        await db.query("RESET ROLE");
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::integer n FROM portal.audit_logs WHERE object_id=ANY($1::uuid[]) AND action='CONTENT_SEEDED'",
              [content.map((r) => r.id)],
            )
          ).rows[0].n,
          6,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::integer n FROM portal.outbox_events WHERE aggregate_id=ANY($1::uuid[]) AND event_type='CONTENT_SEEDED'",
              [content.map((r) => r.id)],
            )
          ).rows[0].n,
          6,
        );
      },
    );
    await t.test(
      "replay does not change published revisions or duplicate audit records",
      async () => {
        const before = await rows();
        assert.ok((await seed()).every((r) => r.action === "preserve"));
        assert.deepEqual(await rows(), before);
      },
    );
    await t.test(
      "upgrades only an unchanged version-one starter draft",
      async () => {
        const banner = (await rows()).find((r) => r.type === "BANNER");
        await db.query(
          "UPDATE portal.content_blocks SET version=1,published_content=NULL,published_at=NULL,published_by=NULL,published_sort_order=NULL,published_version=NULL WHERE id=$1",
          [banner.id],
        );
        await db.query(
          "INSERT INTO portal.audit_logs(object_type,object_id,action,request_id) VALUES('CONTENT',$1,'CONTENT_TEMPLATE_CREATED',gen_random_uuid())",
          [banner.id],
        );
        assert.equal(
          (await seed()).find((r) => r.type === "BANNER").action,
          "publish-starter",
        );
        const updated = (await rows()).find((r) => r.type === "BANNER");
        assert.equal(updated.version, 2);
        assert.equal(updated.published_version, 2);
      },
    );
    await t.test(
      "preserves edited, intentionally unpublished and unrecognized drafts",
      async () => {
        for (const [type, version] of [
          ["PROFILE", 2],
          ["CULTURE", 3],
          ["BENEFIT", 1],
        ]) {
          await db.query(
            "UPDATE portal.content_blocks SET version=$2,published_content=NULL,published_at=NULL,published_by=NULL,published_sort_order=NULL,published_version=NULL WHERE type=$1 AND slot IS NOT NULL",
            [type, version],
          );
        }
        await db.query(
          "UPDATE portal.content_blocks SET draft_content=jsonb_set(draft_content,'{en,title}','\"Edited company copy\"') WHERE slot='profile'",
        );
        const before = await rows();
        assert.ok((await seed()).every((r) => r.action === "preserve"));
        assert.deepEqual(await rows(), before);
      },
    );
    await t.test("refuses a publisher who is not an active ADMIN", async () => {
      await db.query("UPDATE portal.staff_profiles SET role='HR' WHERE id=$1", [
        adminId,
      ]);
      await assert.rejects(seed(), /active ADMIN/);
      await db.query(
        "UPDATE portal.staff_profiles SET role='ADMIN',active=false WHERE id=$1",
        [adminId],
      );
      await assert.rejects(seed(), /active ADMIN/);
    });
  },
);
