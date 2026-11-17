import test from "node:test";
import assert from "node:assert/strict";
import {
  contentDraft,
  contentIssues,
  contentTypes,
} from "../../../src/lib/content/contract.ts";
import {
  companyHome,
  companyAbout,
  companyServices,
  paragraphs,
} from "../../../src/lib/content/public.ts";
import { homeContent } from "../../../src/lib/homeContent.ts";
import { aboutContent } from "../../../src/lib/aboutContent.ts";
import { servicesContent } from "../../../src/lib/servicesContent.ts";
import { contentTemplates } from "../../../scripts/content/templates.ts";
import { draftCompanyContent } from "../../../src/lib/admin/contentPreview.ts";
import {
  canAddItems,
  contentSections,
  itemFields,
  itemKindOptions,
} from "../../../src/lib/admin/contentFields.ts";

// Build the public view of the starter templates exactly as the site would
// read them after `content:seed`: draft -> managed block -> published block.
function publishedStarter(locale) {
  const blocks = contentTemplates().map((template, index) => ({
    id: `block-${index}`,
    type: template.type,
    sortOrder: template.sortOrder,
    version: 1,
    publishedVersion: 1,
    publishedAt: "2026-11-09T00:00:00Z",
    updatedAt: "2026-11-09T00:00:00Z",
    state: "published",
    draft: contentDraft.parse(template.draft),
    approvedChineseFallback: false,
    images: {},
  }));
  return draftCompanyContent(blocks, locale);
}
const editBlock = (company, type, change) => ({
  ...company,
  blocks: {
    ...company.blocks,
    [type]: change(structuredClone(company.blocks[type])),
  },
});

test("starter templates reproduce the redesigned fixtures on every page", () => {
  for (const locale of ["en", "zh"]) {
    const company = publishedStarter(locale);
    const home = companyHome(homeContent[locale], company);
    assert.deepEqual(home.hero_lines, homeContent[locale].hero_lines);
    assert.equal(home.hero_p, homeContent[locale].hero_p);
    assert.equal(home.hero_p2, homeContent[locale].hero_p2);
    assert.equal(home.about_p1, homeContent[locale].about_p1);
    assert.equal(home.about_p2, homeContent[locale].about_p2);
    assert.deepEqual(home.services, homeContent[locale].services);
    assert.deepEqual(home.values, homeContent[locale].values);
    assert.equal(home.values_eyebrow, homeContent[locale].values_eyebrow);
    assert.deepEqual(home.benefits, homeContent[locale].benefits);
    assert.equal(home.benefits_h, homeContent[locale].benefits_h);
    assert.deepEqual(home.offices, homeContent[locale].offices);
    assert.deepEqual(
      companyAbout(aboutContent[locale], company),
      { ...aboutContent[locale] },
    );
    const services = companyServices(servicesContent[locale], company);
    assert.deepEqual(
      services.services.map((s) => [s.title, s.description]),
      servicesContent[locale].services.map((s) => [s.title, s.description]),
    );
  }
});

test("published CMS text always wins; nothing is filtered as 'legacy'", () => {
  let company = publishedStarter("en");
  company = editBlock(company, "BANNER", (block) => {
    block.text.title = "Short headline\nSecond line";
    block.text.body = "Only a lead.";
    return block;
  });
  company = editBlock(company, "CULTURE", (block) => {
    block.items[0].text.title = "Speak with data";
    block.items[0].text.body = "Short.";
    return block;
  });
  company = editBlock(company, "PROFILE", (block) => {
    block.text.body = "First paragraph.\n\nSecond paragraph.";
    block.text.title = "Edited About headline";
    block.items.find((i) => i.kind === "mission").text.body = "Brief.";
    return block;
  });
  const home = companyHome(homeContent.en, company);
  assert.deepEqual(home.hero_lines, ["Short headline", "Second line"]);
  assert.equal(home.hero_p, "Only a lead.");
  assert.equal(home.hero_p2, "", "a removed second paragraph stays removed");
  assert.deepEqual(home.values[0], ["Speak with data", "Short."]);
  assert.equal(home.about_p1, "First paragraph.");
  assert.equal(home.about_p2, "Second paragraph.");
  const about = companyAbout(aboutContent.en, company);
  assert.equal(about.title, "Edited About headline");
  assert.equal(about.mission[0].statement, "Brief.");
});

test("old demo copy is shown only if somebody publishes it, never injected back", () => {
  let company = publishedStarter("en");
  company = editBlock(company, "BANNER", (block) => {
    block.text.title = "Standardised\nOperations";
    return block;
  });
  assert.deepEqual(companyHome(homeContent.en, company).hero_lines, [
    "Standardised",
    "Operations",
  ]);
});

test("services follow edited, added and reordered PROFILE service items", () => {
  let company = publishedStarter("en");
  company = editBlock(company, "PROFILE", (block) => {
    const services = block.items.filter((i) => i.kind === "service");
    services[0].text.title = "Renamed";
    block.items.push({
      ...structuredClone(services[0]),
      id: "service-extra",
      text: { ...services[0].text, title: "Fourth service" },
    });
    return block;
  });
  const home = companyHome(homeContent.en, company);
  const page = companyServices(servicesContent.en, company);
  assert.equal(home.services.length, 4);
  assert.equal(home.services[0].title, "Renamed");
  assert.equal(page.services.length, 4);
  assert.equal(page.services[3].title, "Fourth service");
  assert.ok(page.services[3].photo, "extra rows keep a photograph");
});

test("benefit cards keep the shipped icons and cycle for extra cards", () => {
  let company = publishedStarter("en");
  company = editBlock(company, "BENEFIT", (block) => {
    block.items[1].text.title = "Mentoring";
    return block;
  });
  const { benefits } = companyHome(homeContent.en, company);
  assert.equal(benefits[1].label, "Mentoring");
  assert.equal(benefits[1].icon, homeContent.en.benefits[1].icon);
});

test("paragraph splitting keeps single line breaks and drops blank paragraphs", () => {
  assert.deepEqual(paragraphs("A\nB\n\n\n  \nC"), ["A\nB", "C"]);
  assert.deepEqual(paragraphs(""), []);
  assert.deepEqual(paragraphs(undefined), []);
});

test("starter templates need no banner statistics and stay publishable", () => {
  for (const template of contentTemplates()) {
    assert.deepEqual(contentIssues(template.type, template.draft, true), []);
  }
  const banner = contentTemplates().find((t) => t.type === "BANNER");
  assert.equal(banner.draft.items.length, 0);
  assert.equal(banner.draft.en.body.split("\n\n").length, 2);
});

test("editor only offers fields the public pages draw", () => {
  assert.deepEqual(contentSections.BANNER.fields, ["title", "body", "image"]);
  assert.ok(!canAddItems("BANNER") && !canAddItems("TEAM"));
  assert.deepEqual(itemFields("PROFILE", "history"), ["label", "body", "image"]);
  assert.deepEqual(itemFields("PROFILE", "service"), ["title", "body", "image"]);
  assert.deepEqual(itemFields("BENEFIT", "card"), ["title"]);
  assert.ok(itemFields("LOCATION", "card").includes("locationFilter"));
  assert.deepEqual(itemKindOptions("PROFILE"), ["service", "mission", "history"]);
  // Existing data in a kind the editor no longer adds stays visible and editable.
  assert.deepEqual(itemKindOptions("BANNER", "stat"), ["stat"]);
  for (const type of contentTypes) assert.ok(contentSections[type]);
});
