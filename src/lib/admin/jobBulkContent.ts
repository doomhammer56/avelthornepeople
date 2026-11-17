import type { AdminLang } from "./nav";

export type BulkJobAction = "publish" | "pause" | "resume" | "close";

// Labels for acting on several selected jobs at once from the Jobs list.
export const jobBulkContent = {
  en: {
    actions: {
      publish: "Publish",
      pause: "Pause",
      resume: "Resume",
      close: "Close",
    } satisfies Record<BulkJobAction, string>,
    confirmTitle: (action: BulkJobAction, count: number) =>
      `${{ publish: "Publish", pause: "Pause", resume: "Resume", close: "Close" }[action]} ${count} ${count === 1 ? "job" : "jobs"}?`,
    confirmBody: {
      publish:
        "Draft jobs are submitted first, then every selected job goes live on the careers site.",
      pause: "Paused jobs disappear from the careers site until resumed.",
      resume: "Paused jobs go back live on the careers site.",
      close:
        "Closed jobs cannot be reopened; duplicate a job to advertise it again.",
    } satisfies Record<BulkJobAction, string>,
    skipped: (count: number) =>
      ` ${count} selected ${count === 1 ? "job isn't" : "jobs aren't"} eligible and will be skipped.`,
    done: (count: number) =>
      `${count} ${count === 1 ? "job" : "jobs"} updated.`,
    partial: (ok: number, failed: number) =>
      `${ok} updated, ${failed} failed. Failed jobs may have changed or need review; refresh and try again.`,
    failed: "No jobs were updated. Refresh and try again.",
  },
  zh: {
    actions: {
      publish: "发布",
      pause: "暂停",
      resume: "恢复",
      close: "关闭",
    } satisfies Record<BulkJobAction, string>,
    confirmTitle: (action: BulkJobAction, count: number) =>
      `${{ publish: "发布", pause: "暂停", resume: "恢复", close: "关闭" }[action]} ${count} 个职位？`,
    confirmBody: {
      publish: "草稿职位将先提交，然后所有所选职位将在招聘网站上线。",
      pause: "已暂停的职位在恢复前不会显示在招聘网站上。",
      resume: "已暂停的职位将重新在招聘网站上线。",
      close: "关闭后的职位无法重新开启；如需再次招聘，请复制该职位。",
    } satisfies Record<BulkJobAction, string>,
    skipped: (count: number) => ` 所选职位中有 ${count} 个不适用，将被跳过。`,
    done: (count: number) => `已更新 ${count} 个职位。`,
    partial: (ok: number, failed: number) =>
      `已更新 ${ok} 个，${failed} 个失败。失败的职位可能已被修改或需要审核，请刷新后重试。`,
    failed: "没有职位被更新。请刷新后重试。",
  },
} satisfies Record<AdminLang, unknown>;

// Mirrors the server's state machine so the bar only offers actions that can apply.
export function bulkJobEligible(
  status: "draft" | "pending" | "published" | "paused" | "closed",
  action: BulkJobAction,
) {
  switch (action) {
    case "publish":
      return status === "draft" || status === "pending";
    case "pause":
      return status === "published";
    case "resume":
      return status === "paused";
    case "close":
      return status === "published" || status === "paused";
  }
}
