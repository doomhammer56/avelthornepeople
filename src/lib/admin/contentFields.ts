import type { ContentItem, ContentType } from "../content/contract.ts";

// Describes which managed fields the redesigned public pages actually draw, so
// the editor only offers controls that change something staff can see.
// Keep in step with `companyHome`, `companyAbout` and `companyServices`
// (src/lib/content/public.ts) and the section components they feed.

export type SectionField = "eyebrow" | "title" | "body" | "image";
export type ItemField =
  | "title"
  | "body"
  | "label"
  | "image"
  | "locationFilter";

type Sections = Record<
  ContentType,
  {
    /** Block-level fields drawn on the public site. */
    fields: readonly SectionField[];
    /** Item kinds staff may add. Empty: the block has no repeated items. */
    kinds: readonly ContentItem["kind"][];
    /** Shipped photograph shown when no custom image is chosen. */
    defaultImage?: string;
  }
>;

export const contentSections: Sections = {
  // Hero: headline (one line per row), lead paragraphs, photograph.
  BANNER: {
    fields: ["title", "body", "image"],
    kinds: [],
    defaultImage: "/photos/hero-workplace-1672w.webp",
  },
  // About header (eyebrow + title), company paragraphs, photograph,
  // services, mission & vision and history.
  PROFILE: {
    fields: ["eyebrow", "title", "body", "image"],
    kinds: ["service", "mission", "history"],
    defaultImage: "/photos/company-collaboration-1280w.webp",
  },
  // Culture eyebrow + heading, an About intro and value cards.
  CULTURE: { fields: ["eyebrow", "title", "body"], kinds: ["card"] },
  // Benefits eyebrow + heading; each card is an icon with one short label.
  BENEFIT: { fields: ["eyebrow", "title"], kinds: ["card"] },
  // Not drawn by the current public layout; kept so existing data stays valid.
  LOCATION: { fields: ["title"], kinds: ["card"] },
  // Team band on About.
  TEAM: {
    fields: ["eyebrow", "title", "body", "image"],
    kinds: [],
    defaultImage: "/photos/team-culture-1672w.webp",
  },
};

/** Item kinds to list for a block, always including those already in use. */
export function itemKindOptions(
  type: ContentType,
  current?: ContentItem["kind"],
) {
  const kinds = [...contentSections[type].kinds];
  return current && !kinds.includes(current) ? [...kinds, current] : kinds;
}

/** Item-level fields drawn publicly for this block type and item kind. */
export function itemFields(
  type: ContentType,
  kind: ContentItem["kind"],
): readonly ItemField[] {
  if (type === "PROFILE") {
    if (kind === "history") return ["label", "body", "image"];
    return ["title", "body", "image"];
  }
  if (type === "BENEFIT") return ["title"];
  if (type === "LOCATION") return ["title", "body", "locationFilter"];
  if (kind === "stat") return ["title", "label", "body"];
  return ["title", "body"];
}

/** Whether staff can add new items, or only review ones that already exist. */
export const canAddItems = (type: ContentType) =>
  contentSections[type].kinds.length > 0;

type Hints = Partial<Record<ContentType, Partial<Record<string, string>>>>;
const hints: Record<"en" | "zh", Hints> = {
  en: {
    BANNER: {
      title: "Homepage headline. Put each line of the headline on its own row.",
      body: "Text under the headline. Leave a blank line between the lead and the supporting sentence.",
      image: "Hero photograph on Home.",
    },
    PROFILE: {
      eyebrow: "Small label above the About page headline.",
      title: "Headline at the top of the About page.",
      body: "Company description on Home and About. Leave a blank line between paragraphs.",
      image: "Company photograph in the Home About section.",
      items:
        "Services appear on Home and Services, mission & vision and history on About.",
    },
    CULTURE: {
      body: "Optional introduction under the culture heading on About.",
      items: "Each card is one value, shown on Home and About.",
    },
    BENEFIT: { items: "Home shows the first five benefits, one short label each." },
    LOCATION: {
      title: "The current website design does not display this section.",
    },
    TEAM: { image: "Photograph for the team band on About." },
  },
  zh: {
    BANNER: {
      title: "首页主标题。标题的每一行请单独占一行。",
      body: "标题下方的文字。导语与补充说明之间请空一行。",
      image: "首页横幅照片。",
    },
    PROFILE: {
      eyebrow: "「关于我们」页面主标题上方的小标签。",
      title: "「关于我们」页面顶部的主标题。",
      body: "首页与「关于我们」的公司简介。段落之间请空一行。",
      image: "首页「关于我们」区块的公司照片。",
      items:
        "业务服务显示于首页与服务页，使命愿景与发展历程显示于「关于我们」。",
    },
    CULTURE: {
      body: "「关于我们」企业文化标题下方的简介（可选）。",
      items: "每张卡片是一条价值观，显示于首页与「关于我们」。",
    },
    BENEFIT: { items: "首页显示前五项福利，每项一句简短文字。" },
    LOCATION: { title: "当前网站设计不显示此区块。" },
    TEAM: { image: "「关于我们」团队区块的照片。" },
  },
};

export function fieldHint(
  lang: "en" | "zh",
  type: ContentType,
  field: SectionField | "items",
) {
  return hints[lang][type]?.[field];
}
