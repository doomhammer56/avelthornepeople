import type { AdminLang } from "./nav";

export type JobStatus = "draft" | "pending" | "published" | "paused" | "closed";

// Shared across the jobs list and the editor, so a status always renders
// with the same label and tag color everywhere (A02/A03's status system).
export const jobStatusTone: Record<
  JobStatus,
  { tone: "gray" | "amber" | "accent" | "violet" | "rose"; label: Record<AdminLang, string> }
> = {
  draft: { tone: "gray", label: { en: "Draft", zh: "草稿" } },
  pending: { tone: "amber", label: { en: "Pending review", zh: "待审核" } },
  published: { tone: "accent", label: { en: "Published", zh: "已发布" } },
  paused: { tone: "violet", label: { en: "Paused", zh: "已暂停" } },
  closed: { tone: "rose", label: { en: "Closed", zh: "已关闭" } },
};

export const jobStatusOrder: readonly JobStatus[] = [
  "draft",
  "pending",
  "published",
  "paused",
  "closed",
];
