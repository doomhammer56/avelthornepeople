import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pageOrder,
  pageSections,
  defaultSection,
} from "../../../src/lib/admin/contentLayout.ts";
import {
  contentSections,
  itemFields,
} from "../../../src/lib/admin/contentFields.ts";
import {
  contentUsage,
  previewSections,
} from "../../../src/lib/admin/contentPreview.ts";
import { contentTypes } from "../../../src/lib/content/contract.ts";

const components = fileURLToPath(
  new URL("../../../src/components/", import.meta.url),
);
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full)
      : /\.tsx$/.test(name)
        ? [full]
        : [];
  });
}
// The public pages only; the console's own components must not count.
const publicSource = walk(components)
  .filter((file) => !/[\\/]admin[\\/]/.test(file))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

test("section keys are unique and every page's sections belong to it", () => {
  const keys = pageOrder.flatMap((page) =>
    pageSections[page].map((section) => {
      assert.ok(section.key.startsWith(`${page}.`), section.key);
      return section.key;
    }),
  );
  assert.equal(new Set(keys).size, keys.length);
});

test("every selector the editor outlines exists in the public components", () => {
  for (const page of pageOrder)
    for (const section of pageSections[page]) {
      const selector = section.selector;
      const found = selector.startsWith("#")
        ? new RegExp(
            `(?:\\bid|sectionId)\\s*[=:]\\s*["{]*\\s*["']${selector.slice(1)}["']`,
          ).test(publicSource) ||
          // HomeAboutSection takes its id from a default parameter.
          new RegExp(`sectionId\\s*=\\s*"${selector.slice(1)}"`).test(
            publicSource,
          )
        : publicSource.includes(selector.slice(1));
      assert.ok(found, `${section.key}: ${selector} is not in a public page`);
    }
});

test("sections only expose fields and item kinds their block really supports", () => {
  for (const page of pageOrder)
    for (const section of pageSections[page]) {
      if (!section.type) {
        assert.deepEqual(section.fields, [], section.key);
        assert.deepEqual(section.kinds, [], section.key);
        continue;
      }
      const block = contentSections[section.type];
      for (const field of section.fields)
        assert.ok(block.fields.includes(field), `${section.key}: ${field}`);
      for (const kind of [...section.kinds, ...(section.legacyKinds ?? [])]) {
        if (section.legacyKinds?.includes(kind)) continue;
        assert.ok(block.kinds.includes(kind), `${section.key}: ${kind}`);
        assert.ok(itemFields(section.type, kind).length > 0);
      }
    }
});

test("the editor offers no section the website does not draw", () => {
  const used = new Set(
    pageOrder.flatMap((page) => pageSections[page].map((s) => s.type)),
  );
  assert.ok(!used.has("LOCATION"), "Locations is not drawn by any page");
  for (const type of contentTypes.filter((t) => t !== "LOCATION"))
    assert.ok(used.has(type), `${type} must appear on a page`);
  assert.deepEqual(contentUsage.LOCATION, []);
});

test("shared blocks list every page that renders them", () => {
  assert.deepEqual(contentUsage.PROFILE, ["home", "about", "services"]);
  assert.deepEqual(contentUsage.CULTURE, ["home", "about"]);
  assert.deepEqual(contentUsage.BANNER, ["home"]);
  assert.deepEqual(contentUsage.BENEFIT, ["home"]);
  assert.deepEqual(contentUsage.TEAM, ["about"]);
  for (const [type, pages] of Object.entries(contentUsage))
    for (const page of pages)
      assert.ok(previewSections[page][type], `${type}: ${page}`);
});

test("the home benefits section is capped at the five the page shows", () => {
  const benefits = pageSections.home.find((s) => s.type === "BENEFIT");
  assert.equal(benefits.maxItems, 5);
});

test("each page opens on an editable section where one exists", () => {
  for (const page of ["home", "about", "services"])
    assert.ok(defaultSection(page).type, page);
  assert.equal(defaultSection("contact"), undefined);
});
