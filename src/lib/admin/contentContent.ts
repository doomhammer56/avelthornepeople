import type { AdminLang } from "./nav";

export type ContentBlockState = "published" | "draft" | "unpublished";

export const blockStateTone: Record<
  ContentBlockState,
  { tone: "accent" | "gray" | "amber"; label: Record<AdminLang, string> }
> = {
  published: { tone: "accent", label: { en: "Published", zh: "已发布" } },
  draft: { tone: "gray", label: { en: "Draft", zh: "草稿" } },
  unpublished: {
    tone: "amber",
    label: { en: "Unpublished changes", zh: "未发布修改" },
  },
};

// Bilingual labels for the Content screen (A05).
export const contentContent: Record<
  AdminLang,
  {
    title: string;
    publish: string;
    titleLabel: string;
    bodyLabel: string;
    preview: string;
    updated: string;
  }
> = {
  en: {
    title: "Company content",
    publish: "Publish this block",
    titleLabel: "Title",
    bodyLabel: "Body",
    preview: "Site preview",
    updated: "Updated",
  },
  zh: {
    title: "公司内容",
    publish: "发布此区块",
    titleLabel: "标题",
    bodyLabel: "正文",
    preview: "官网预览",
    updated: "更新于",
  },
};
