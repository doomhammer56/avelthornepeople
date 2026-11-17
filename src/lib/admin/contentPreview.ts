import type { CompanyContent } from "../content/public.ts";
import type { ContentType, ManagedContentBlock } from "../content/contract.ts";
import type { AdminLang } from "./nav.ts";
import {
  pageOrder,
  pageSections,
  type ContentPreviewPage,
} from "./contentLayout.ts";

export type { ContentPreviewPage };
export type ContentSelection = {
  /** Public section the click landed in (see contentLayout.pageSections). */
  section?: string;
  type?: ContentType;
  itemId?: string;
  field?: "title" | "body" | "eyebrow" | "imageAlt" | "image" | "label";
};

// Project drafts into the same display contract used by the public components.
// Incomplete text stays visible as a draft and never requires publishing to preview it.
export function draftCompanyContent(
  blocks: readonly ManagedContentBlock[],
  locale: AdminLang,
): CompanyContent {
  return {
    failed: false,
    blocks: Object.fromEntries(
      blocks.map((block) => [
        block.type,
        {
          id: block.id,
          type: block.type,
          sortOrder: block.sortOrder,
          version: block.version,
          locale,
          englishFallback: false,
          text: block.draft[locale],
          image: block.images[block.draft.imageId ?? ""] ?? null,
          items: block.draft.items.map((item) => ({
            id: item.id,
            kind: item.kind,
            text: item[locale],
            image: block.images[item.imageId ?? ""] ?? null,
            locationFilter: item.locationFilter,
          })),
        },
      ]),
    ),
  };
}

// Selectors per page and block, derived from the public layout so the editor
// and the preview can never disagree about which sections exist.
export const previewSections: Record<
  ContentPreviewPage,
  Partial<Record<ContentType, string>>
> = Object.fromEntries(
  pageOrder.map((page) => {
    const bySelector: Partial<Record<ContentType, string[]>> = {};
    for (const section of pageSections[page])
      if (section.type)
        (bySelector[section.type] ??= []).push(section.selector);
    return [
      page,
      Object.fromEntries(
        Object.entries(bySelector).map(([type, list]) => [
          type,
          list.join(", "),
        ]),
      ),
    ];
  }),
) as Record<ContentPreviewPage, Partial<Record<ContentType, string>>>;

// Expose shared ownership before staff save or publish a reusable section.
// Editing a page must not imply that the same content is independent elsewhere.
export const contentUsage: Record<ContentType, ContentPreviewPage[]> = {
  BANNER: [],
  PROFILE: [],
  CULTURE: [],
  BENEFIT: [],
  LOCATION: [],
  TEAM: [],
};
for (const page of pageOrder)
  for (const section of pageSections[page])
    if (section.type && !contentUsage[section.type].includes(page))
      contentUsage[section.type].push(page);

export const contentPreviewText = {
  en: {
    pages: {
      home: "Home",
      about: "About",
      services: "Services",
      contact: "Contact",
    },
    page: "Page",
    language: "Content language",
    desktop: "Desktop",
    mobile: "Mobile",
    preview: "Website draft preview",
    section: "Section",
    edit: "Edit section",
    guidance:
      "Select an outlined section to edit its wording or images. Links and forms are inactive in this preview.",
    draft: "Draft preview · private until published",
    unsaved: "Unsaved changes",
    saved: "Saved draft",
    shared: "Appears on",
    scope: "Save and publish apply to this section in both languages.",
    leave: "You have unsaved content changes. Leave without saving?",
    readOnly: "Read-only access",
    loading: "Preparing website preview…",
    missing:
      "This section is not displayed on the selected page. Choose one of its pages above.",
    noContent: "Add a content section to start building your page preview.",
    noSections: "This page has no editable content sections.",
    fixed: "Fixed section",
    notCreated: "This section has no content yet.",
    createSection: "Create this section",
    manage: "Manage in Jobs",
    maxItems: (n: number) => `The website shows at most ${n} items here.`,
  },
  zh: {
    pages: {
      home: "首页",
      about: "关于我们",
      services: "服务",
      contact: "联系我们",
    },
    page: "页面",
    language: "内容语言",
    desktop: "桌面",
    mobile: "手机",
    preview: "网站草稿预览",
    section: "区块",
    edit: "编辑区块",
    guidance: "选择带轮廓的区块以编辑文案或图片。预览中的链接和表单不可操作。",
    draft: "草稿预览 · 发布前仅内部可见",
    unsaved: "有未保存的修改",
    saved: "草稿已保存",
    shared: "显示于",
    scope: "保存与发布针对当前区块的中英文内容。",
    leave: "内容修改尚未保存，确定离开吗？",
    readOnly: "只读权限",
    loading: "正在准备网站预览…",
    missing: "所选页面不显示此区块，请切换至上方列出的页面。",
    noContent: "请先添加内容区块以开始页面预览。",
    noSections: "此页面没有可编辑的内容区块。",
    fixed: "固定区块",
    notCreated: "此区块暂无内容。",
    createSection: "创建此区块",
    manage: "前往职位管理",
    maxItems: (n: number) => `网站此处最多显示 ${n} 项。`,
  },
} as const;
