import type { ContentItem, ContentType } from "../content/contract.ts";
import type { AdminLang } from "./nav.ts";

// The sections each public page really renders, in page order. The content
// editor lists exactly these for the selected page, so staff see the same
// structure as the website. Several sections can read one stored block
// (PROFILE feeds Home Services/About, the About header, Mission, History and
// the Services page); each section only exposes the fields it actually draws.
//
// Keep in step with HomePage, AboutPage, ServicesPage and
// src/lib/content/public.ts.

export type ContentPreviewPage = "home" | "about" | "services" | "contact";
export type SectionField = "eyebrow" | "title" | "body" | "image";

type Text = Record<AdminLang, string>;

export type PageSection = {
  /** Unique across pages, e.g. "home.hero". */
  key: string;
  type: ContentType | null;
  label: Text;
  /** Matches the section element inside the rendered public page. */
  selector: string;
  /** Block-level fields this section draws. */
  fields: readonly SectionField[];
  /** Item kinds this section lists. Empty: no repeated items. */
  kinds: readonly ContentItem["kind"][];
  /**
   * Older items of these kinds are still drawn publicly, so the editor lists
   * them (and can convert them) but does not offer to add new ones.
   */
  legacyKinds?: readonly ContentItem["kind"][];
  /** The public layout shows at most this many items. */
  maxItems?: number;
  /** What is editable here and what stays fixed in the site design. */
  note: Text;
  /** Fixed sections (no stored block) can link to where they are managed. */
  manageHref?: string;
};

const none = [] as const;

export const pageSections: Record<ContentPreviewPage, readonly PageSection[]> =
  {
    home: [
      {
        key: "home.hero",
        type: "BANNER",
        label: { en: "Hero", zh: "首页横幅" },
        selector: ".home-hero",
        fields: ["title", "body", "image"],
        kinds: none,
        note: {
          en: "Headline (one line per row), intro text and photo. The two buttons are fixed.",
          zh: "主标题（每行一行）、导语和照片。两个按钮为固定内容。",
        },
      },
      {
        key: "home.services",
        type: "PROFILE",
        label: { en: "Services", zh: "服务" },
        selector: "#services",
        fields: none,
        kinds: ["service"],
        note: {
          en: "Service cards, also shown on the Services page. The section heading is fixed.",
          zh: "服务卡片，同时显示于服务页。区块标题为固定内容。",
        },
      },
      {
        key: "home.about",
        type: "PROFILE",
        label: { en: "About us", zh: "关于我们" },
        selector: "#about",
        fields: ["body", "image"],
        kinds: none,
        note: {
          en: "Company text and photo. The heading and button are fixed.",
          zh: "公司简介和照片。标题和按钮为固定内容。",
        },
      },
      {
        key: "home.culture",
        type: "CULTURE",
        label: { en: "Culture", zh: "企业文化" },
        selector: "#culture",
        fields: ["eyebrow", "title"],
        kinds: ["card"],
        note: {
          en: "Label, heading and value cards, also shown on About.",
          zh: "小标签、标题和价值观卡片，同时显示于「关于我们」。",
        },
      },
      {
        key: "home.careers",
        type: null,
        label: { en: "Latest openings", zh: "最新职位" },
        selector: "#careers",
        fields: none,
        kinds: none,
        note: {
          en: "The latest published jobs appear here automatically. Manage them under Jobs.",
          zh: "最新已发布的职位会自动显示在这里，请在「职位管理」中维护。",
        },
        manageHref: "/admin/jobs",
      },
      {
        key: "home.benefits",
        type: "BENEFIT",
        label: { en: "Benefits", zh: "员工福利" },
        selector: "#benefits",
        fields: ["eyebrow", "title"],
        kinds: ["card"],
        maxItems: 5,
        note: {
          en: "Label, heading and up to five benefits, one short line each. Icons are fixed.",
          zh: "小标签、标题和最多五项福利，每项一句话。图标为固定内容。",
        },
      },
      {
        key: "home.connect",
        type: null,
        label: { en: "Contact call-to-action", zh: "联系我们" },
        selector: "#connect",
        fields: none,
        kinds: none,
        note: {
          en: "Fixed text in the site design. It links visitors to the Contact page.",
          zh: "网站设计中的固定文字，引导访客前往联系页面。",
        },
      },
    ],
    about: [
      {
        key: "about.header",
        type: "PROFILE",
        label: { en: "Page header", zh: "页面标题" },
        selector: ".page-header",
        fields: ["eyebrow", "title"],
        kinds: none,
        note: {
          en: "Small label and headline at the top of the About page.",
          zh: "「关于我们」页面顶部的小标签和主标题。",
        },
      },
      {
        key: "about.company",
        type: "PROFILE",
        label: { en: "Our company", zh: "公司介绍" },
        selector: "#company",
        fields: ["body"],
        kinds: none,
        note: {
          en: "Company text, shared with Home. The photo and heading are fixed here.",
          zh: "公司简介，与首页共用。此处的照片和标题为固定内容。",
        },
      },
      {
        key: "about.mission",
        type: "PROFILE",
        label: { en: "Mission & vision", zh: "使命与愿景" },
        selector: "#mission",
        fields: none,
        kinds: ["mission"],
        legacyKinds: ["card"],
        note: {
          en: "Mission and vision columns, each with an optional photo.",
          zh: "使命与愿景两栏，每栏可添加照片。",
        },
      },
      {
        key: "about.history",
        type: "PROFILE",
        label: { en: "History", zh: "发展历程" },
        selector: "#history",
        fields: none,
        kinds: ["history"],
        note: {
          en: "Timeline entries: a year, a description and an optional photo.",
          zh: "时间线条目：年份、说明和可选照片。",
        },
      },
      {
        key: "about.team",
        type: "TEAM",
        label: { en: "Team", zh: "团队" },
        selector: "#team",
        fields: ["eyebrow", "title", "body", "image"],
        kinds: none,
        note: {
          en: "Label, heading, text and the team photograph.",
          zh: "小标签、标题、文字和团队照片。",
        },
      },
      {
        key: "about.culture",
        type: "CULTURE",
        label: { en: "Culture", zh: "企业文化" },
        selector: "#culture",
        fields: ["eyebrow", "title", "body"],
        kinds: ["card"],
        note: {
          en: "Label, heading, optional introduction and value cards, shared with Home.",
          zh: "小标签、标题、可选简介和价值观卡片，与首页共用。",
        },
      },
    ],
    services: [
      {
        key: "services.header",
        type: null,
        label: { en: "Page header", zh: "页面标题" },
        selector: ".page-header",
        fields: none,
        kinds: none,
        note: {
          en: "The title and intro of the Services page are fixed in the site design.",
          zh: "服务页面的标题和简介为网站设计中的固定内容。",
        },
      },
      {
        key: "services.list",
        type: "PROFILE",
        label: { en: "Services", zh: "服务" },
        selector: "#services",
        fields: none,
        kinds: ["service"],
        note: {
          en: "One row per service with a title, description and photo, shared with Home.",
          zh: "每项服务一行：标题、说明和照片，与首页共用。",
        },
      },
    ],
    contact: [],
  };

export const pageOrder: readonly ContentPreviewPage[] = [
  "home",
  "about",
  "services",
  "contact",
];

export function sectionOf(page: ContentPreviewPage, key: string | undefined) {
  return pageSections[page].find((section) => section.key === key);
}

/** First section staff can edit on a page, else its first section. */
export function defaultSection(page: ContentPreviewPage) {
  const sections = pageSections[page];
  return sections.find((section) => section.type) ?? sections[0];
}
