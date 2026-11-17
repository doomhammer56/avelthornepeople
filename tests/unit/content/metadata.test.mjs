import test from "node:test";
import assert from "node:assert/strict";
import {
  companyMetadata,
  marketingMetadata,
} from "../../../src/lib/content/metadata.ts";
import { companyServices } from "../../../src/lib/content/public.ts";
import { servicesContent } from "../../../src/lib/servicesContent.ts";
import { contentTemplates } from "../../../scripts/content/templates.ts";

function company(locale) {
  return {
    failed: false,
    blocks: Object.fromEntries(
      contentTemplates().map((t) => [
        t.type,
        {
          type: t.type,
          locale,
          text: t.draft[locale],
          image: null,
          items: t.draft.items.map((item) => ({
            ...item,
            text: item[locale],
            image: null,
          })),
        },
      ]),
    ),
  };
}
test("Published EN/ZH content supplies descriptions, canonical/hreflang and sharing metadata", () => {
  for (const locale of ["en", "zh"]) {
    const published = company(locale);
    for (const page of ["home", "about", "services"]) {
      const metadata = companyMetadata(page, locale, published);
      const suffix = page === "home" ? "" : `/${page}`;
      assert.ok(
        metadata.description.length > 0 && metadata.description.length <= 160,
      );
      assert.equal(metadata.alternates.canonical, `/${locale}${suffix}`);
      assert.deepEqual(metadata.alternates.languages, {
        en: `/en${suffix}`,
        zh: `/zh${suffix}`,
      });
      assert.equal(metadata.robots.index, true);
      assert.equal(metadata.openGraph.description, metadata.description);
      assert.equal(metadata.twitter.title, metadata.title);
    }
    assert.ok(companyServices(servicesContent[locale], published).title);
  }
});
test("Marketing pages are indexable from approved copy, with a default language", () => {
  for (const locale of ["en", "zh"]) {
    for (const page of ["home", "about", "services", "careers", "contact"]) {
      const metadata = marketingMetadata(locale, page);
      const suffix = page === "home" ? "" : `/${page}`;
      assert.equal(metadata.robots.index, true);
      assert.equal(metadata.robots.follow, true);
      assert.ok(metadata.description.length > 20 && metadata.description.length <= 160);
      assert.equal(metadata.alternates.canonical, `/${locale}${suffix}`);
      assert.equal(metadata.alternates.languages["x-default"], `/en${suffix}`);
      assert.equal(metadata.openGraph.locale, locale === "zh" ? "zh_CN" : "en_US");
    }
  }
});
test("Empty/unavailable managed pages are not indexable and cannot leak draft descriptions or images", () => {
  for (const page of ["home", "about", "services"]) {
    const empty = companyMetadata(page, "en", { blocks: {}, failed: false });
    assert.equal(empty.robots.index, false);
    assert.equal(empty.description, undefined);
    assert.equal(empty.openGraph.images, undefined);
    assert.equal(
      companyMetadata(page, "en", { ...company("en"), failed: true }).robots
        .index,
      false,
    );
  }
  const noServices = company("en");
  noServices.blocks.PROFILE.items = [];
  assert.equal(
    companyMetadata("services", "en", noServices).robots.index,
    false,
  );
});
