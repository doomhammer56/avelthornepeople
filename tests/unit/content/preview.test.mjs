import test from "node:test";
import assert from "node:assert/strict";
import {
  draftCompanyContent,
  contentUsage,
  previewSections,
} from "../../../src/lib/admin/contentPreview.ts";
import { emptyDraft } from "../../../src/lib/content/contract.ts";

// Use an unpublished fixture to exercise drafts independently of database access.
// Browser selection and preview projection must never require a publication command.
function fixture() {
  const draft = emptyDraft();
  draft.en.title = "Unsaved headline";
  draft.zh.title = "未保存的标题";
  draft.imageId = "draft-image";
  draft.items.push({
    id: "office-1",
    kind: "card",
    en: {
      title: "London",
      body: "Office",
      label: "",
      imageAlt: "Office image",
    },
    zh: { title: "伦敦", body: "办公室", label: "", imageAlt: "办公室图片" },
    imageId: null,
    locationFilter: "London",
  });
  return {
    id: "location",
    type: "LOCATION",
    sortOrder: 40,
    version: 2,
    publishedVersion: null,
    publishedAt: null,
    updatedAt: "2026-10-27T10:00:00Z",
    state: "draft",
    draft,
    approvedChineseFallback: true,
    images: {
      "draft-image": {
        id: "draft-image",
        width: 800,
        height: 600,
        url: "/api/admin/content/images/draft-image",
      },
    },
  };
}

test("draft previews preserve private images, stable item IDs and the selected language without fallback", () => {
  const block = fixture();
  const before = JSON.stringify(block);
  const english = draftCompanyContent([block], "en").blocks.LOCATION;
  const chinese = draftCompanyContent([block], "zh").blocks.LOCATION;
  assert.equal(english.text.title, "Unsaved headline");
  assert.equal(chinese.text.title, "未保存的标题");
  assert.equal(english.englishFallback, false);
  assert.equal(english.image.url, "/api/admin/content/images/draft-image");
  assert.equal(english.items[0].id, "office-1");
  assert.equal(english.items[0].locationFilter, "London");
  assert.equal(english.items[0].image, null);
  assert.equal(JSON.stringify(block), before);
});

test("incomplete drafts render without pretending to have published content", () => {
  const block = fixture();
  block.draft.en.title = "";
  block.draft.imageId = "missing-image";
  const preview = draftCompanyContent([block], "en");
  assert.equal(preview.blocks.LOCATION.text.title, "");
  assert.equal(preview.blocks.LOCATION.image, null);
  assert.equal(preview.blocks.BANNER, undefined);
  assert.deepEqual(draftCompanyContent([], "zh"), {
    blocks: {},
    failed: false,
  });
});

test("every shared section has a selection target on each declared preview page", () => {
  for (const [type, pages] of Object.entries(contentUsage)) {
    for (const page of pages)
      assert.ok(previewSections[page][type], `${type}: ${page}`);
  }
  assert.deepEqual(contentUsage.PROFILE, ["home", "about", "services"]);
  assert.deepEqual(contentUsage.LOCATION, []);
});
