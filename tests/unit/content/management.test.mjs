import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  contentDraft,
  contentIssues,
  emptyDraft,
  createContent,
  saveContent,
  imageIds,
} from "../../../src/lib/content/contract.ts";
import { canonicalImage } from "../../../src/server/content/images.ts";
import { companyHome, companyAbout } from "../../../src/lib/content/public.ts";
import { homeContent } from "../../../src/lib/homeContent.ts";
import { aboutContent } from "../../../src/lib/aboutContent.ts";
import { contentTemplates } from "../../../scripts/content/templates.ts";
import { sendContentCommand } from "../../../src/lib/admin/contentClient.ts";
test("The six draft templates satisfy the same bilingual contract and publication rules", () => {
  const templates = contentTemplates();
  assert.equal(templates.length, 6);
  for (const template of templates) {
    const draft = contentDraft.parse(template.draft);
    assert.deepEqual(contentIssues(template.type, draft, true, false), []);
    assert.ok(
      createContent.safeParse({
        ...template,
        id: randomUUID(),
        requestId: randomUUID(),
      }).success,
    );
  }
});
test("Text bounds, unknown properties and duplicate item IDs are rejected before normalization", () => {
  const draft = contentTemplates()[2].draft;
  assert.ok(!contentDraft.safeParse({ ...draft, unknown: true }).success);
  assert.ok(
    !contentDraft.safeParse({
      ...draft,
      zh: { ...draft.zh, title: " ".repeat(201) },
    }).success,
  );
  assert.ok(
    !contentDraft.safeParse({
      ...draft,
      items: [...draft.items, draft.items[0]],
    }).success,
  );
  assert.ok(
    !contentDraft.safeParse({ ...draft, items: Array(31).fill(draft.items[0]) })
      .success,
  );
  assert.equal(
    contentDraft.parse({ ...draft, zh: { ...draft.zh, title: "　中文　" } }).zh
      .title,
    "中文",
  );
});
test("Publication requires Chinese and explicit whole-block fallback for incomplete English", () => {
  const draft = emptyDraft();
  assert.ok(
    contentIssues("BANNER", draft, true).some((i) => i.field === "zh.title"),
  );
  draft.zh.title = "中文";
  draft.zh.body = "正文";
  assert.ok(
    contentIssues("BANNER", draft, true).some(
      (i) => i.code === "fallback_required",
    ),
  );
  assert.deepEqual(contentIssues("BANNER", draft, true, true), []);
  draft.imageId = randomUUID();
  assert.ok(
    contentIssues("BANNER", draft, true, true).some(
      (i) => i.field === "zh.imageAlt",
    ),
  );
});
test("Types constrain item kinds; history years and image references retain clear identities", () => {
  const draft = contentTemplates()[1].draft;
  assert.ok(contentIssues("CULTURE", draft).some((i) => i.code === "invalid"));
  draft.items[0].imageId = randomUUID();
  draft.imageId = draft.items[0].imageId;
  assert.equal(imageIds(draft).length, 1);
  draft.items.find((i) => i.kind === "history").zh.label = "not a year";
  assert.ok(
    contentIssues("PROFILE", draft).some((i) => i.field.endsWith("zh.label")),
  );
  assert.ok(
    !saveContent.safeParse({
      draft,
      sortOrder: 0,
      expectedVersion: 1,
      requestId: randomUUID(),
      publishedContent: {},
    }).success,
  );
});
test("Canonical image processing validates signatures, strips metadata and bounds output", async () => {
  const input = await sharp({
    create: { width: 3000, height: 20, channels: 3, background: "blue" },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: "Synthetic secret" } } })
    .toBuffer();
  const result = await canonicalImage(input, "image/jpeg");
  assert.equal(result.width, 2400);
  const metadata = await sharp(result.data).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  assert.equal(result.sha256.length, 64);
});
test("Image handling rejects SVG disguised as PNG, mismatched MIME, corruption and oversized input", async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  for (const [data, type] of [
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "image/png"],
    [png, "image/jpeg"],
    [Buffer.alloc(3_000_001), "image/png"],
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"],
  ])
    await assert.rejects(canonicalImage(data, type), (e) => e.status === 400);
  const huge = await sharp({
    create: { width: 5000, height: 5000, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    canonicalImage(huge, "image/png"),
    (e) => e.status === 400,
  );
});
test("Public composition keeps the approved redesign copy when there is no published content", () => {
  const empty = { blocks: {}, failed: false },
    home = companyHome(homeContent.en, empty),
    about = companyAbout(aboutContent.en, empty);
  assert.equal(home.hero_p, homeContent.en.hero_p);
  assert.deepEqual(home.hero_lines, homeContent.en.hero_lines);
  assert.equal(home.about_p1, homeContent.en.about_p1);
  assert.deepEqual(home.benefits, homeContent.en.benefits);
  assert.deepEqual(home.offices, homeContent.en.offices);
  assert.deepEqual(about.mission, aboutContent.en.mission);
  assert.deepEqual(about.history, aboutContent.en.history);
  assert.equal(about.title, aboutContent.en.title);
  assert.equal(home.nav[0], homeContent.en.nav[0]);
});
test("Content client reports failed writes and accepts only committed versioned blocks", async () => {
  await assert.rejects(
    sendContentCommand("/api/admin/content", {}, "POST", async () =>
      Response.json(
        {
          error: "validation_failed",
          issues: [
            { field: "zh.title", code: "required", value: "private draft" },
          ],
        },
        { status: 400 },
      ),
    ),
    (error) =>
      error.status === 400 &&
      !JSON.stringify(error.issues).includes("private draft"),
  );
  await assert.rejects(
    sendContentCommand("/api/admin/content", {}, "POST", async () =>
      Response.json({ saved: true }),
    ),
    (e) => e.status === 503,
  );
});
test("Image references use canonical UUIDs and animated WebP is rejected", async () => {
  const draft = emptyDraft(),
    id = randomUUID();
  draft.imageId = id.toUpperCase();
  assert.equal(contentDraft.parse(draft).imageId, id);
  const pixels = Buffer.from([
    ...Array(4).fill([255, 0, 0]).flat(),
    ...Array(4).fill([0, 0, 255]).flat(),
  ]);
  const animated = await sharp(pixels, {
    raw: { width: 2, height: 4, pageHeight: 2, channels: 3 },
  })
    .webp({ delay: [100, 100], loop: 0 })
    .toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await assert.rejects(
    canonicalImage(animated, "image/webp"),
    (error) => error.status === 400,
  );
});
