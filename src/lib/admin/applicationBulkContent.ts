import type { AdminLang } from "./nav";

// Only stages that need no extra details can be applied to many candidates at once.
// Interview and Offer collect per-candidate details, so they stay on the detail page.
export type BulkApplicationStage = "SCREENING" | "REJECTED";

export const applicationBulkContent = {
  en: {
    actions: {
      SCREENING: "Move to screening",
      REJECTED: "Reject",
    } satisfies Record<BulkApplicationStage, string>,
    confirmTitle: (stage: BulkApplicationStage, count: number) =>
      stage === "REJECTED"
        ? `Reject ${count} ${count === 1 ? "application" : "applications"}?`
        : `Move ${count} ${count === 1 ? "application" : "applications"} to screening?`,
    confirmBody: {
      SCREENING: "The selected applications move to the Screening stage.",
      REJECTED:
        "The selected applications move to Rejected and each candidate is sent a rejection email.",
    } satisfies Record<BulkApplicationStage, string>,
    skipped: (count: number) =>
      ` ${count} selected ${count === 1 ? "application is" : "applications are"} already in this stage and will be skipped.`,
    done: (count: number) =>
      `${count} ${count === 1 ? "application" : "applications"} updated.`,
    partial: (ok: number, failed: number) =>
      `${ok} updated, ${failed} failed. Failed applications may have changed; refresh and try again.`,
    failed: "No applications were updated. Refresh and try again.",
    exportSelected: "Export selected",
  },
  zh: {
    actions: { SCREENING: "移至筛选", REJECTED: "拒绝" } satisfies Record<
      BulkApplicationStage,
      string
    >,
    confirmTitle: (stage: BulkApplicationStage, count: number) =>
      stage === "REJECTED"
        ? `拒绝 ${count} 份申请？`
        : `将 ${count} 份申请移至筛选阶段？`,
    confirmBody: {
      SCREENING: "所选申请将移至筛选阶段。",
      REJECTED: "所选申请将移至已拒绝，并向每位候选人发送拒绝邮件。",
    } satisfies Record<BulkApplicationStage, string>,
    skipped: (count: number) =>
      ` 所选申请中有 ${count} 份已处于该阶段，将被跳过。`,
    done: (count: number) => `已更新 ${count} 份申请。`,
    partial: (ok: number, failed: number) =>
      `已更新 ${ok} 份，${failed} 份失败。失败的申请可能已被修改，请刷新后重试。`,
    failed: "没有申请被更新。请刷新后重试。",
    exportSelected: "导出所选",
  },
} satisfies Record<AdminLang, unknown>;
