import { z } from "zod";
export const contentTypes = [
  "BANNER",
  "PROFILE",
  "CULTURE",
  "BENEFIT",
  "LOCATION",
  "TEAM",
] as const;
export const itemKinds = [
  "card",
  "mission",
  "history",
  "service",
  "stat",
] as const;
export const contentNames = {
  BANNER: { en: "Home banner", zh: "首页横幅" },
  PROFILE: { en: "Company profile", zh: "公司介绍" },
  CULTURE: { en: "Culture", zh: "企业文化" },
  BENEFIT: { en: "Benefits", zh: "员工福利" },
  LOCATION: { en: "Locations", zh: "办公地点" },
  TEAM: { en: "Team", zh: "团队" },
} as const;
const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim());
const imageId = z
  .uuid()
  .transform((value) => value.toLowerCase())
  .nullable();
export const translation = z
  .object({
    title: text(200),
    body: text(6000),
    eyebrow: text(120),
    imageAlt: text(250),
  })
  .strict();
export const itemTranslation = z
  .object({
    title: text(200),
    body: text(2000),
    label: text(120),
    imageAlt: text(250),
  })
  .strict();
const item = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
    kind: z.enum(itemKinds),
    en: itemTranslation,
    zh: itemTranslation,
    imageId,
    locationFilter: text(100),
  })
  .strict();
export const contentDraft = z
  .object({
    en: translation,
    zh: translation,
    imageId,
    items: z.array(item).max(30),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.items.map((i) => i.id)).size !== value.items.length)
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "duplicate_item",
      });
    if (new TextEncoder().encode(JSON.stringify(value)).length > 240000)
      ctx.addIssue({ code: "custom", message: "too_large" });
  });
export type ContentType = (typeof contentTypes)[number];
export type ContentDraft = z.infer<typeof contentDraft>;
export type ContentTranslation = z.infer<typeof translation>;
export type ContentItem = ContentDraft["items"][number];
export type ContentIssue = {
  field: string;
  code: "invalid" | "required" | "fallback_required" | "image_unavailable";
};
const kinds: Record<ContentType, readonly string[]> = {
  BANNER: ["stat"],
  PROFILE: ["mission", "history", "service", "card"],
  CULTURE: ["card"],
  BENEFIT: ["card"],
  LOCATION: ["card"],
  TEAM: ["card"],
};
export function contentIssues(
  type: ContentType,
  draft: ContentDraft,
  publish = false,
  fallback = false,
): ContentIssue[] {
  const issues: ContentIssue[] = [];
  for (const [index, item] of draft.items.entries()) {
    if (!kinds[type].includes(item.kind))
      issues.push({ field: `items.${index}.kind`, code: "invalid" });
    if (item.kind === "history" && !/^\d{4}$/.test(item.zh.label))
      issues.push({ field: `items.${index}.zh.label`, code: "invalid" });
  }
  if (!publish) return issues;
  for (const lang of fallback ? (["zh"] as const) : (["zh", "en"] as const)) {
    if (!draft[lang].title)
      issues.push({
        field: `${lang}.title`,
        code: lang === "en" ? "fallback_required" : "required",
      });
    if (["BANNER", "PROFILE"].includes(type) && !draft[lang].body)
      issues.push({
        field: `${lang}.body`,
        code: lang === "en" ? "fallback_required" : "required",
      });
    if (draft.imageId && !draft[lang].imageAlt)
      issues.push({ field: `${lang}.imageAlt`, code: "required" });
    for (const [index, item] of draft.items.entries()) {
      if (!item[lang].title)
        issues.push({
          field: `items.${index}.${lang}.title`,
          code: lang === "en" ? "fallback_required" : "required",
        });
      if (item.imageId && !item[lang].imageAlt)
        issues.push({
          field: `items.${index}.${lang}.imageAlt`,
          code: "required",
        });
      if (item.kind === "history" && !/^\d{4}$/.test(item[lang].label))
        issues.push({ field: `items.${index}.${lang}.label`, code: "invalid" });
    }
  }
  return issues.slice(0, 20);
}
export function imageIds(draft: ContentDraft) {
  return [
    ...new Set(
      [draft.imageId, ...draft.items.map((i) => i.imageId)].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
}
export const createContent = z
  .object({
    id: z.uuid(),
    type: z.enum(contentTypes),
    draft: contentDraft,
    sortOrder: z.number().int().min(0).max(10000),
    requestId: z.uuid(),
  })
  .strict();
export const saveContent = createContent
  .omit({ id: true, type: true })
  .extend({ expectedVersion: z.number().int().positive() })
  .strict();
export const contentAction = z
  .object({
    action: z.enum(["publish", "unpublish"]),
    expectedVersion: z.number().int().positive(),
    requestId: z.uuid(),
    allowChineseFallback: z.boolean().default(false),
  })
  .strict();
export type ContentImage = {
  id: string;
  width: number;
  height: number;
  url: string;
};
export type ManagedContentBlock = {
  id: string;
  type: ContentType;
  sortOrder: number;
  version: number;
  publishedVersion: number | null;
  publishedAt: string | null;
  updatedAt: string;
  state: "draft" | "published" | "unpublished";
  draft: ContentDraft;
  approvedChineseFallback: boolean;
  images: Record<string, ContentImage>;
};
export type PublicContentBlock = {
  id: string;
  type: ContentType;
  sortOrder: number;
  version: number;
  locale: "en" | "zh";
  englishFallback: boolean;
  text: ContentTranslation;
  image: ContentImage | null;
  items: {
    id: string;
    kind: ContentItem["kind"];
    text: ContentItem["en"];
    image: ContentImage | null;
    locationFilter: string;
  }[];
};
export const emptyTranslation = () => ({
  title: "",
  body: "",
  eyebrow: "",
  imageAlt: "",
});
export const emptyDraft = (): ContentDraft => ({
  en: emptyTranslation(),
  zh: emptyTranslation(),
  imageId: null,
  items: [],
});
