import { homeContent } from "../../src/lib/homeContent.ts";
import { aboutContent } from "../../src/lib/aboutContent.ts";
import { teamContent } from "../../src/lib/teamContent.ts";
import {
  emptyDraft,
  contentTypes,
  type ContentItem,
  type ContentType,
} from "../../src/lib/content/contract.ts";
// A blank line separates paragraphs in managed body text.
const PARAGRAPH = "\n\n";
export function contentTemplates() {
  return contentTypes.map((type) => {
    const draft = emptyDraft();
    for (const lang of ["en", "zh"] as const) {
      const h = homeContent[lang],
        a = aboutContent[lang];
      draft[lang] = {
        title:
          type === "BANNER"
            ? h.hero_lines.join("\n")
            : type === "PROFILE"
              ? a.title
              : type === "CULTURE"
                ? h.values_h
                : type === "BENEFIT"
                  ? h.benefits_h
                  : type === "LOCATION"
                    ? h.offices_h
                    : teamContent[lang].title,
        body:
          type === "BANNER"
            ? [h.hero_p, h.hero_p2].filter(Boolean).join(PARAGRAPH)
            : type === "PROFILE"
              ? [h.about_p1, h.about_p2].filter(Boolean).join(PARAGRAPH)
              : type === "TEAM"
                ? teamContent[lang].description
                : "",
        // The redesigned hero has no eyebrow, so the banner keeps none.
        eyebrow:
          type === "PROFILE"
            ? a.eyebrow
            : type === "CULTURE"
              ? h.values_eyebrow
              : type === "BENEFIT"
                ? h.benefits_eyebrow
                : type === "TEAM"
                  ? teamContent[lang].eyebrow
                  : "",
        imageAlt: type === "TEAM" ? teamContent[lang].imageAlt : "",
      };
    }
    const add = (
      kind: ContentItem["kind"],
      index: number,
      en: { title: string; body: string; label?: string },
      zh: { title: string; body: string; label?: string },
      locationFilter = "",
    ) =>
      draft.items.push({
        id: `${kind}-${index}`,
        kind,
        en: { ...en, label: en.label ?? "", imageAlt: "" },
        zh: { ...zh, label: zh.label ?? "", imageAlt: "" },
        imageId: null,
        locationFilter,
      });
    if (type === "PROFILE") {
      aboutContent.en.mission.forEach((m, i) =>
        add(
          "mission",
          i,
          { title: m.label, body: m.statement },
          {
            title: aboutContent.zh.mission[i].label,
            body: aboutContent.zh.mission[i].statement,
          },
        ),
      );
      aboutContent.en.history.forEach((m, i) =>
        add(
          "history",
          i,
          { title: m.year, label: m.year, body: m.description },
          {
            title: aboutContent.zh.history[i].year,
            label: aboutContent.zh.history[i].year,
            body: aboutContent.zh.history[i].description,
          },
        ),
      );
      homeContent.en.services.forEach((s, i) =>
        add(
          "service",
          i,
          { title: s.title, body: s.description, label: s.tags },
          {
            title: homeContent.zh.services[i].title,
            body: homeContent.zh.services[i].description,
            label: homeContent.zh.services[i].tags,
          },
        ),
      );
    }
    if (type === "CULTURE") {
      homeContent.en.values.forEach((value, i) =>
        add(
          "card",
          i,
          { title: value[0], body: value[1] },
          {
            title: homeContent.zh.values[i][0],
            body: homeContent.zh.values[i][1],
          },
        ),
      );
    }
    if (type === "BENEFIT") {
      homeContent.en.benefits.forEach((benefit, i) =>
        add(
          "card",
          i,
          { title: benefit.label, body: "" },
          { title: homeContent.zh.benefits[i].label, body: "" },
        ),
      );
    }
    if (type === "LOCATION")
      homeContent.en.offices.forEach((office, i) =>
        add(
          "card",
          i,
          { title: office.city, body: office.description },
          {
            title: homeContent.zh.offices[i].city,
            body: homeContent.zh.offices[i].description,
          },
          office.filterValue,
        ),
      );
    return {
      type: type as ContentType,
      draft,
      sortOrder: contentTypes.indexOf(type) * 10,
    };
  });
}
