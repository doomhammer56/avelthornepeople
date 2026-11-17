import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
loadAuthTestEnvironment();
const { createStaffSession } = await import("../../helpers/staff-session.mjs");
const { contentTemplates } =
  await import("../../../scripts/content/templates.ts");
test(
  "Company content commands and public projections in the guarded test database",
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
    let staff;
    t.after(async () => {
      await db.query("ROLLBACK").catch(() => {});
      await db.end();
      if (staff) await staff.remove();
    });
    await db.query("BEGIN");
    if (
      !(
        await db.query(
          "SELECT to_regprocedure('portal_private.manage_content(text,uuid,integer,uuid,text,jsonb,integer,boolean)') IS NOT NULL ready",
        )
      ).rows[0].ready
    )
      await db.query(
        readFileSync(
          "prisma/migrations/20261025000700_company_content/migration.sql",
          "utf8",
        )
          .replace(/^BEGIN;/, "")
          .replace(/COMMIT;\s*$/, ""),
      );
    await db.query("GRANT portal_runtime,portal_public_reader TO CURRENT_USER");
    staff = await createStaffSession(db, "ADMIN");
    await db.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [
        staff.id,
        JSON.stringify({ sub: staff.id, session_id: staff.sessionId }),
      ],
    );
    // Existing managed slots are isolated transactionally and restored on rollback.
    await db.query(
      "UPDATE portal.content_blocks SET slot=NULL WHERE slot IS NOT NULL",
    );
    async function scope(role, fn) {
      await db.query("SAVEPOINT scope");
      try {
        await db.query(`SET LOCAL ROLE ${role}`);
        const result = await fn();
        await db.query("RESET ROLE");
        await db.query("RELEASE SAVEPOINT scope");
        return result;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT scope");
        await db.query("RELEASE SAVEPOINT scope");
        throw error;
      }
    }
    const id = randomUUID(),
      image = randomUUID(),
      draft = contentTemplates()[0].draft;
    const command = (
      action,
      version,
      body = null,
      order = null,
      fallback = false,
      request = randomUUID(),
    ) =>
      scope(
        "portal_runtime",
        async () =>
          (
            await db.query(
              "SELECT portal_private.manage_content($1,$2,$3,$4,$5,$6,$7,$8) result",
              [
                action,
                id,
                version,
                request,
                action === "create" ? "BANNER" : null,
                body ? JSON.stringify(body) : null,
                order,
                fallback,
              ],
            )
          ).rows[0].result,
      );
    const publicRows = () =>
      scope("portal_public_reader", () =>
        db.query("SELECT * FROM portal.company_content WHERE id=$1", [id]),
      );
    await t.test(
      "Direct runtime content writes are revoked and missing assets rejected",
      async () => {
        await assert.rejects(
          scope("portal_runtime", () =>
            db.query(
              "INSERT INTO portal.content_blocks(type,draft_content) VALUES('BANNER','{}')",
            ),
          ),
          (e) => e.code === "42501",
        );
        await assert.rejects(
          command("create", null, { ...draft, imageId: randomUUID() }, 0),
          (e) => e.code === "22023",
        );
      },
    );
    await t.test(
      "Provider roles have no media-table or command privilege",
      async () => {
        for (const role of ["anon", "authenticated", "service_role"]) {
          const result = await db.query(
            "SELECT has_table_privilege($1,'portal.content_images','SELECT') media,has_function_privilege($1,'portal_private.manage_content(text,uuid,integer,uuid,text,jsonb,integer,boolean)','EXECUTE') command",
            [role],
          );
          assert.equal(result.rows[0].media, false);
          assert.equal(result.rows[0].command, false);
        }
      },
    );
    await t.test(
      "Image registration and draft save remain invisible to public roles",
      async () => {
        await scope("portal_runtime", () =>
          db.query(
            "SELECT portal_private.register_content_image($1,$2,10,10,100,$3)",
            [image, `images/${image}.webp`, randomBytes(32).toString("hex")],
          ),
        );
        draft.imageId = image;
        draft.zh.imageAlt = "中文图片";
        draft.en.imageAlt = "Image";
        await command("create", null, draft, 10);
        assert.equal((await publicRows()).rows.length, 0);
        assert.equal(
          (
            await scope("portal_public_reader", () =>
              db.query(
                "SELECT id FROM portal.published_content_images WHERE id=$1",
                [image],
              ),
            )
          ).rows.length,
          0,
        );
      },
    );
    await t.test(
      "Publishing is atomic and makes only approved images/content visible",
      async () => {
        await command("publish", 1);
        const row = (await publicRows()).rows[0];
        assert.equal(row.published_content.en.title, draft.en.title);
        assert.equal(row.version, 2);
        assert.equal(
          (
            await scope("portal_public_reader", () =>
              db.query(
                "SELECT id FROM portal.published_content_images WHERE id=$1",
                [image],
              ),
            )
          ).rows.length,
          1,
        );
        await assert.rejects(
          scope("portal_public_reader", () =>
            db.query("SELECT draft_content FROM portal.content_blocks"),
          ),
          (e) => e.code === "42501",
        );
      },
    );
    await t.test(
      "Draft text, image and order edits do not change public data; retries replay exactly",
      async () => {
        const request = randomUUID(),
          changed = {
            ...draft,
            en: { ...draft.en, title: "Private changed title" },
            imageId: null,
          };
        const first = await command("save", 2, changed, 99, false, request);
        assert.deepEqual(
          await command("save", 2, changed, 99, false, request),
          first,
        );
        await assert.rejects(
          command("save", 2, draft, 98, false, request),
          (e) => e.code === "40001",
        );
        const publicRow = (await publicRows()).rows[0];
        assert.equal(publicRow.sort_order, 10);
        assert.equal(publicRow.published_content.imageId, image);
        assert.equal(publicRow.published_content.en.title, draft.en.title);
        assert.equal(
          Number(
            (
              await db.query(
                "SELECT count(*) n FROM portal.audit_logs WHERE request_id=$1",
                [request],
              )
            ).rows[0].n,
          ),
          1,
        );
      },
    );
    await t.test(
      "Chinese fallback is explicit, stale versions fail and unpublish preserves draft",
      async () => {
        const fallbackDraft = { ...draft, en: { ...draft.en, title: "" } };
        await command("save", 3, fallbackDraft, 99);
        await assert.rejects(command("publish", 4), (e) => e.code === "22023");
        await command("publish", 4, null, null, true);
        assert.equal(
          (await publicRows()).rows[0].published_content.englishFallback,
          true,
        );
        await assert.rejects(
          command("unpublish", 4),
          (e) => e.code === "40001",
        );
        await command("unpublish", 5);
        assert.equal((await publicRows()).rows.length, 0);
        assert.equal(
          (
            await db.query(
              "SELECT draft_content FROM portal.content_blocks WHERE id=$1",
              [id],
            )
          ).rows[0].draft_content.zh.title,
          draft.zh.title,
        );
        assert.equal(
          (
            await scope("portal_public_reader", () =>
              db.query(
                "SELECT id FROM portal.published_content_images WHERE id=$1",
                [image],
              ),
            )
          ).rows.length,
          0,
        );
      },
    );
    await t.test(
      "HR/READ_ONLY inspect drafts but cannot change or publish them",
      async () => {
        for (const role of ["HR", "READ_ONLY"]) {
          await db.query(
            "UPDATE portal.staff_profiles SET role=$2 WHERE id=$1",
            [staff.id, role],
          );
          assert.equal(
            (
              await scope("portal_runtime", () =>
                db.query("SELECT id FROM portal.content_blocks WHERE id=$1", [
                  id,
                ]),
              )
            ).rows.length,
            1,
          );
          await assert.rejects(
            command("publish", 6),
            (e) => e.code === "42501",
          );
        }
        await db.query(
          "UPDATE portal.staff_profiles SET active=false WHERE id=$1",
          [staff.id],
        );
        await assert.rejects(command("publish", 6), (e) => e.code === "42501");
      },
    );
  },
);
