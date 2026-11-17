import type { AdminLang } from "./nav";

// Labels for deactivating/reactivating team members from the Accounts table.
// "Remove" is deliberately deactivation: the staff policy retains the profile,
// business references and audit history, so no account is ever hard-deleted.
export const accountsActionContent = {
  en: {
    deactivate: "Deactivate",
    activate: "Activate",
    activity: "Activity",
    activityHint: "Open the audit log for actions by this person",
    deactivateTitle: (name: string) => `Deactivate ${name}?`,
    deactivateBody:
      "They are signed out and can no longer use the console. Their profile and everything they did stay in the audit log, and you can activate them again at any time.",
    activateTitle: (name: string) => `Activate ${name}?`,
    activateBody:
      "They can sign in again with the permissions of their current role.",
    bulkDeactivateTitle: (count: number) =>
      `Deactivate ${count} ${count === 1 ? "member" : "members"}?`,
    bulkDeactivateBody:
      "They are signed out and can no longer use the console. Profiles and audit history are kept, and they can be activated again.",
    bulkActivateTitle: (count: number) =>
      `Activate ${count} ${count === 1 ? "member" : "members"}?`,
    bulkActivateBody:
      "They can sign in again with the permissions of their current role.",
    skipped: (count: number) =>
      ` ${count} selected ${count === 1 ? "member is" : "members are"} already in this state and will be skipped.`,
    done: (count: number) =>
      `${count} ${count === 1 ? "member" : "members"} updated.`,
    syncPending: (count: number) =>
      ` ${count} still need provider synchronization; use Retry synchronization on those rows.`,
    partial: (ok: number, failed: number) =>
      `${ok} updated, ${failed} failed. The last remaining administrator cannot be deactivated, and members changed elsewhere need a refresh.`,
    failed:
      "No members were updated. The last remaining administrator cannot be deactivated; otherwise refresh and try again.",
    selectRow: "Select member",
  },
  zh: {
    deactivate: "停用",
    activate: "启用",
    activity: "操作记录",
    activityHint: "在操作日志中查看此人的操作",
    deactivateTitle: (name: string) => `停用 ${name}？`,
    deactivateBody:
      "该成员将被登出，且无法再使用管理后台。其个人资料和全部操作记录仍保留在操作日志中，您可随时重新启用。",
    activateTitle: (name: string) => `启用 ${name}？`,
    activateBody: "该成员可按当前角色权限重新登录。",
    bulkDeactivateTitle: (count: number) => `停用 ${count} 位成员？`,
    bulkDeactivateBody:
      "这些成员将被登出，且无法再使用管理后台。个人资料和操作记录将保留，可随时重新启用。",
    bulkActivateTitle: (count: number) => `启用 ${count} 位成员？`,
    bulkActivateBody: "这些成员可按当前角色权限重新登录。",
    skipped: (count: number) =>
      ` 所选成员中有 ${count} 位已处于该状态，将被跳过。`,
    done: (count: number) => `已更新 ${count} 位成员。`,
    syncPending: (count: number) =>
      ` 其中 ${count} 位仍需同步身份提供方，请在对应行点击“重试同步”。`,
    partial: (ok: number, failed: number) =>
      `已更新 ${ok} 位，${failed} 位失败。最后一位管理员无法被停用；在其他地方被修改的成员需要刷新。`,
    failed: "没有成员被更新。最后一位管理员无法被停用；否则请刷新后重试。",
    selectRow: "选择成员",
  },
} satisfies Record<AdminLang, unknown>;
