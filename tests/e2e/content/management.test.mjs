import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
import sharp from "sharp";
import { performance } from "node:perf_hooks";
import {
  warmPublicPaths,
  assertPublicationSync,
} from "../../helpers/publishing-sync.mjs";
import {
  parkContentSlots,
  restoreContentSlots,
  removeContentSlotBackup,
} from "../../helpers/content-slots.mjs";
import {
  loadAuthTestEnvironment,
  connectAuthTestDatabase,
} from "../../../scripts/auth/test-env.mjs";
loadAuthTestEnvironment();
const { createStaffSession } = await import("../../helpers/staff-session.mjs");
const { contentTemplates } =
  await import("../../../scripts/content/templates.ts");
const { storageAdminClient } =
  await import("../../../src/server/adapters/storage/config.ts");
const { configureContentBucket } =
  await import("../../../src/server/content/bucket.ts");
test(
  "Built company content APIs and private image publication on the guarded test project",
  { timeout: 360000 },
  async (t) => {
    const db = await connectAuthTestDatabase(
      () =>
        new pg.Client({
          connectionString: process.env.DIRECT_URL,
          connectionTimeoutMillis: 15000,
          statement_timeout: 15000,
        }),
    );
    const users = [],
      blocks = [],
      images = [];
    let child,
      parked = { rows: [] };
    t.after(async () => {
      if (child && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await stopped;
      }
      try {
        const assets = (
          await db.query(
            "SELECT id,object_key FROM portal.content_images WHERE uploaded_by=ANY($1::uuid[])",
            [users.map((u) => u.id)],
          )
        ).rows;
        if (assets.length) {
          const removed = await storageAdminClient()
            .storage.from("company-content")
            .remove(assets.map((a) => a.object_key));
          assert.equal(removed.error, null);
        }
        await db.query("BEGIN");
        await db.query(
          "DELETE FROM portal_private.content_commands WHERE actor_id=ANY($1::uuid[])",
          [users.map((u) => u.id)],
        );
        await db.query(
          "DELETE FROM portal.outbox_events WHERE aggregate_id=ANY($1::uuid[])",
          [[...blocks, ...assets.map((a) => a.id)]],
        );
        await db.query(
          "DELETE FROM portal.audit_logs WHERE actor_id=ANY($1::uuid[])",
          [users.map((u) => u.id)],
        );
        await db.query(
          "DELETE FROM portal.content_blocks WHERE id=ANY($1::uuid[])",
          [blocks],
        );
        await db.query(
          "DELETE FROM portal.content_images WHERE uploaded_by=ANY($1::uuid[])",
          [users.map((u) => u.id)],
        );
        await restoreContentSlots(db, parked);
        await db.query(
          "DELETE FROM portal.staff_profiles WHERE id=ANY($1::uuid[])",
          [users.map((u) => u.id)],
        );
        await db.query("COMMIT");
        removeContentSlotBackup(parked);
        t.diagnostic(
          `QA-01 cleanup: ${parked.rows.length} original content rows restored and verified exactly`,
        );
      } finally {
        await db.query("ROLLBACK").catch(() => {});
        await db.end();
        for (const u of users) await u.remove();
      }
    });
    assert.equal(
      (await db.query("SELECT pg_try_advisory_lock(7606,66) locked")).rows[0]
        .locked,
      true,
      "Another content test is running",
    );
    await parkContentSlots(db, parked);
    if (parked.backupPath)
      t.diagnostic(`QA-01 recovery backup: ${parked.backupPath}`);
    assert.equal(
      (await configureContentBucket(storageAdminClient(), true)).configured,
      true,
    );
    for (const role of ["ADMIN", "HR", "READ_ONLY"])
      users.push(await createStaffSession(db, role));
    const [lead, hr, reader] = users;
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "-H",
        "127.0.0.1",
        "-p",
        String(port),
      ],
      {
        env: {
          ...process.env,
          AUTH_APP_ORIGIN: origin,
          PUBLIC_SITE_URL: origin,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        const response = await fetch(origin + "/api/admin/content", {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (response.status === 401) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(ready, "Build/start the server first");
    async function call(
      path,
      {
        user = lead,
        method = "GET",
        body,
        binary,
        mime = "image/png",
        cookie = false,
        cross = false,
      } = {},
    ) {
      const headers = {};
      if (user)
        headers[cookie ? "cookie" : "authorization"] = cookie
          ? user.cookie
          : `Bearer ${user.token}`;
      if (method !== "GET") {
        headers["content-type"] = binary ? mime : "application/json";
        headers.origin = cross ? "https://attacker.invalid" : origin;
      }
      return fetch(origin + path, {
        method,
        headers,
        body: binary ?? (body ? JSON.stringify(body) : undefined),
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
      });
    }
    const png = await sharp({
        create: { width: 24, height: 16, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer(),
      id = randomUUID();
    blocks.push(id);
    let saved;
    const draft = structuredClone(contentTemplates()[0].draft);
    draft.en.title = `BE06 public ${randomUUID()}`;
    draft.zh.title = `BE06 中文 ${randomUUID()}`;
    const publicationPaths = [
      "/api/content?locale=en&type=BANNER",
      "/api/content?locale=zh&type=BANNER",
      "/en",
      "/zh",
    ];
    const command = async (action, expectedVersion, extra = {}) => {
      const checksPublication = action === "publish" || action === "unpublish";
      if (checksPublication) await warmPublicPaths(origin, publicationPaths);
      const response = await call(
        `/api/admin/content/${id}${action === "save" ? "" : "/actions"}`,
        {
          method: action === "save" ? "PATCH" : "POST",
          body: {
            expectedVersion,
            requestId: randomUUID(),
            ...(action === "save" ? { draft, sortOrder: 99 } : { action }),
            ...extra,
          },
        },
      );
      const acknowledgedAt = performance.now();
      if (checksPublication && response.status === 200) {
        const block = (await response.clone().json()).block;
        const visible = action === "publish";
        await assertPublicationSync(
          t,
          origin,
          `content ${action} v${block.version}`,
          acknowledgedAt,
          ["en", "zh"].flatMap((locale) => {
            const language =
              locale === "en" && block.approvedChineseFallback ? "zh" : locale;
            const title = draft[language].title;
            return [
              {
                path: `/api/content?locale=${locale}&type=BANNER`,
                matches: async (current) => {
                  if (current.status !== 200) {
                    await current.text();
                    return false;
                  }
                  const found = (await current.json()).blocks.find(
                    (item) => item.id === id,
                  );
                  return visible
                    ? found?.version === block.publishedVersion &&
                        found?.text.title === title
                    : !found;
                },
              },
              {
                path: `/${locale}`,
                matches: async (current) => {
                  const html = await current.text();
                  return (
                    current.status === 200 &&
                    (visible
                      ? html.includes(title)
                      : [draft.en.title, draft.zh.title]
                          .filter(Boolean)
                          .every((value) => !html.includes(value)))
                  );
                },
              },
            ];
          }),
        );
      }
      return response;
    };
    await t.test(
      "Anonymous drafts/previews fail, staff inspection works and only ADMIN writes",
      async () => {
        assert.equal(
          (await call("/api/admin/content", { user: null })).status,
          401,
        );
        assert.equal(
          (await call("/api/admin/content", { user: hr })).status,
          200,
        );
        assert.equal(
          (
            await call("/api/admin/content/images", {
              user: reader,
              method: "POST",
              binary: png,
            })
          ).status,
          403,
        );
        const body = {
          id,
          type: "BANNER",
          draft,
          sortOrder: 0,
          requestId: randomUUID(),
        };
        assert.equal(
          (await call("/api/admin/content", { user: hr, method: "POST", body }))
            .status,
          403,
        );
        assert.equal(
          (
            await call("/api/admin/content", {
              method: "POST",
              body,
              cookie: true,
              cross: true,
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "Image upload validates bytes, stores canonical private WebP and never publishes a draft URL",
      async () => {
        assert.equal(
          (
            await call("/api/admin/content/images", {
              method: "POST",
              binary: Buffer.from("<svg/>"),
              mime: "image/png",
            })
          ).status,
          400,
        );
        for (let i = 0; i < 2; i++) {
          const response = await call("/api/admin/content/images", {
            method: "POST",
            binary: png,
          });
          assert.equal(response.status, 200);
          images.push((await response.json()).image);
        }
        draft.imageId = images[0].id;
        draft.en.imageAlt = "Approved synthetic image";
        draft.zh.imageAlt = "测试图片";
        const privateImage = await call(images[0].url, { user: reader });
        assert.equal(privateImage.status, 200);
        assert.equal(
          (
            await sharp(
              Buffer.from(await privateImage.arrayBuffer()),
            ).metadata()
          ).format,
          "webp",
        );
        assert.equal((await call(images[0].url, { user: null })).status, 401);
        assert.equal(
          (await call(`/api/content/images/${images[0].id}`, { user: null }))
            .status,
          404,
        );
        const publicStorage = await fetch(
          `${process.env.SUPABASE_URL}/storage/v1/object/public/company-content/images/${images[0].id}.webp`,
        );
        assert.ok(!publicStorage.ok);
        await publicStorage.body?.cancel();
      },
    );
    await t.test(
      "Draft create/save/reload stays private; first publication reaches public API, metadata and Home",
      async () => {
        let response = await call("/api/admin/content", {
          method: "POST",
          body: {
            id,
            type: "BANNER",
            draft,
            sortOrder: 0,
            requestId: randomUUID(),
          },
        });
        assert.equal(response.status, 200);
        saved = (await response.json()).block;
        assert.equal(saved.version, 1);
        assert.deepEqual(
          (await (await call("/api/content?locale=en", { user: null })).json())
            .blocks,
          [],
        );
        response = await command("publish", 1);
        assert.equal(response.status, 200);
        saved = (await response.json()).block;
        const data = await (
          await call("/api/content?locale=en&type=BANNER", { user: null })
        ).json();
        assert.equal(data.blocks[0].text.title, draft.en.title);
        assert.equal(data.blocks[0].version, 2);
        assert.ok(!JSON.stringify(data).includes("draft_content"));
        const html = await (await call("/en", { user: null })).text();
        assert.ok(html.includes(draft.en.title));
        assert.ok(html.includes(`/api/content/images/${images[0].id}`));
        const image = await call(`/api/content/images/${images[0].id}`, {
          user: null,
        });
        assert.equal(image.status, 200);
        assert.equal(image.headers.get("content-type"), "image/webp");
      },
    );
    await t.test(
      "Saved draft image/order/text cannot leak; retries are idempotent and stale writes conflict",
      async () => {
        const publishedTitle = draft.en.title;
        draft.en.title = "BE06 PRIVATE unsaved-to-public title";
        draft.imageId = images[1].id;
        const body = {
          draft,
          sortOrder: 99,
          expectedVersion: 2,
          requestId: randomUUID(),
        };
        let response = await call(`/api/admin/content/${id}`, {
          method: "PATCH",
          body,
        });
        assert.equal(response.status, 200);
        assert.equal(
          (await call(`/api/admin/content/${id}`, { method: "PATCH", body }))
            .status,
          200,
        );
        assert.equal(
          (
            await call(`/api/admin/content/${id}`, {
              method: "PATCH",
              body: { ...body, sortOrder: 98 },
            })
          ).status,
          409,
        );
        const data = await (
          await call("/api/content?locale=en&type=BANNER", { user: null })
        ).json();
        assert.equal(data.blocks[0].text.title, publishedTitle);
        assert.equal(data.blocks[0].sortOrder, 0);
        assert.equal(
          (await call(`/api/content/images/${images[1].id}`, { user: null }))
            .status,
          404,
        );
        response = await command("publish", 3);
        assert.equal(response.status, 200);
        const current = await (
          await call("/api/content?locale=en&type=BANNER", { user: null })
        ).json();
        assert.equal(current.blocks[0].text.title, draft.en.title);
        assert.equal(current.blocks[0].sortOrder, 99);
        assert.equal(
          (await call(`/api/content/images/${images[0].id}`, { user: null }))
            .status,
          404,
        );
      },
    );
    await t.test(
      "Missing English requires explicit fallback; unpublish removes current text/images",
      async () => {
        draft.en.title = "";
        draft.en.body = "";
        assert.equal((await command("save", 4)).status, 200);
        assert.equal((await command("publish", 5)).status, 400);
        assert.equal(
          (await command("publish", 5, { allowChineseFallback: true })).status,
          200,
        );
        const data = await (
          await call("/api/content?locale=en&type=BANNER", { user: null })
        ).json();
        assert.equal(data.blocks[0].locale, "zh");
        assert.equal(data.blocks[0].englishFallback, true);
        const html = await (await call("/en", { user: null })).text();
        assert.ok(html.includes("English version not available"));
        assert.ok(html.includes(draft.zh.title));
        assert.equal((await command("unpublish", 5)).status, 409);
        assert.equal((await command("unpublish", 6)).status, 200);
        assert.equal(
          (
            await (
              await call("/api/content?locale=en&type=BANNER", { user: null })
            ).json()
          ).blocks.length,
          0,
        );
        assert.equal(
          (await call(`/api/content/images/${images[1].id}`, { user: null }))
            .status,
          404,
        );
        const after = await (await call("/en", { user: null })).text();
        assert.ok(!after.includes(draft.zh.title));
        assert.match(after, /<meta name="robots" content="noindex, follow"/);
      },
    );
    await t.test(
      "Profile, culture, benefit, location and team publications render in their existing public sections",
      async () => {
        for (const template of contentTemplates().filter(
          (v) => v.type !== "BANNER",
        )) {
          const blockId = randomUUID();
          blocks.push(blockId);
          const value = structuredClone(template.draft);
          value.en.title = `BE06 ${template.type} ${randomUUID()}`;
          value.zh.title = `BE06 中文 ${template.type}`;
          if (template.type === "PROFILE") {
            const service = value.items.find((item) => item.kind === "service");
            service.en.title = `BE06 dynamic service ${randomUUID()}`;
            service.zh.title = "BE06 动态服务";
          }
          if (template.type === "LOCATION") {
            value.items[0].en.title = `BE06 dynamic office ${randomUUID()}`;
            value.items[0].zh.title = "BE06 动态地点";
          }
          if (template.type === "TEAM")
            value.items = [
              {
                id: "member",
                kind: "card",
                en: {
                  title: "Synthetic team",
                  body: "Synthetic biography",
                  label: "Synthetic role",
                  imageAlt: "Synthetic portrait",
                },
                zh: {
                  title: "测试团队",
                  body: "测试简介",
                  label: "测试职位",
                  imageAlt: "测试图片",
                },
                imageId: images[0].id,
                locationFilter: "",
              },
            ];
          const created = await call("/api/admin/content", {
            method: "POST",
            body: {
              id: blockId,
              type: template.type,
              draft: value,
              sortOrder: template.sortOrder,
              requestId: randomUUID(),
            },
          });
          assert.equal(created.status, 200);
          const published = await call(
            `/api/admin/content/${blockId}/actions`,
            {
              method: "POST",
              body: {
                action: "publish",
                expectedVersion: 1,
                requestId: randomUUID(),
              },
            },
          );
          assert.equal(published.status, 200);
          for (const locale of ["en", "zh"]) {
            const url =
              template.type === "TEAM" || template.type === "PROFILE"
                ? `/${locale}/about`
                : `/${locale}`;
            const html = await (await call(url, { user: null })).text();
            assert.ok(
              html.includes(value[locale].title),
              `Missing ${template.type} on ${locale}`,
            );
            if (template.type === "PROFILE") {
              assert.match(html, /<meta name="description" content="[^"]+"/);
              assert.match(html, /<meta name="robots" content="index, follow"/);
              assert.match(
                html,
                /<meta property="og:description" content="[^"]+"/,
              );
              assert.match(
                html,
                new RegExp(
                  `<link rel="canonical" href="[^"]+/${locale}/about"`,
                ),
              );
              const serviceHtml = await (
                await call(`/${locale}/services`, { user: null })
              ).text();
              assert.ok(
                serviceHtml.includes(
                  value.items.find((item) => item.kind === "service")[locale]
                    .title,
                ),
              );
              assert.match(
                serviceHtml,
                /<meta name="description" content="[^"]+"/,
              );
              assert.match(
                serviceHtml,
                /<meta name="robots" content="index, follow"/,
              );
            }
          }
        }
      },
    );
    await t.test(
      "EN/ZH consoles use real save controls and anonymous content cannot select draft fields",
      async () => {
        for (const lang of ["en", "zh"]) {
          const response = await call(`/admin/content?lang=${lang}`, {
            cookie: true,
          });
          assert.equal(response.status, 200);
          const html = await response.text();
          assert.ok(html.includes(lang === "en" ? "Save draft" : "保存草稿"));
        }
        assert.equal(
          (await call("/api/content?locale=en&draft=true", { user: null }))
            .status,
          400,
        );
        assert.equal(
          (await call("/api/content?locale=fr", { user: null })).status,
          400,
        );
        const query = await db.query(
          "SELECT safe_changes FROM portal.audit_logs WHERE actor_id=$1 AND object_type='CONTENT'",
          [lead.id],
        );
        assert.ok(
          query.rows.every(
            (row) => !JSON.stringify(row.safe_changes).includes("PRIVATE"),
          ),
        );
      },
    );
    await t.test(
      "SEO discovery includes both languages and permits published image crawling",
      async () => {
        const sitemap = await (
          await call("/sitemap.xml", { user: null })
        ).text();
        for (const locale of ["en", "zh"])
          for (const path of [
            "",
            "/about",
            "/services",
            "/careers",
            "/contact",
          ])
            assert.match(
              sitemap,
              new RegExp(`<loc>[^<]+/${locale}${path}</loc>`),
            );
        const robots = await (await call("/robots.txt", { user: null })).text();
        assert.ok(robots.includes("Allow: /api/content/images/"));
        assert.ok(robots.includes("Disallow: /admin"));
      },
    );
  },
);
