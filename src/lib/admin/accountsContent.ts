import type { AdminLang } from "./nav";

// Bilingual labels for the Accounts & roles screen (A01, admin-only).
export const accountsContent: Record<
  AdminLang,
  {
    title: string;
    subtitle: string;
    invite: string;
    columns: {
      member: string;
      role: string;
      scope: string;
      lastLogin: string;
      status: string;
    };
    active: string;
    disabled: string;
    noPermTitle: string;
    noPermBody: string;
    actionsPending: string;
    roleChanged: (name: string, role: string) => string;
  }
> = {
  en: {
    title: "Accounts & roles",
    subtitle:
      "Manage staff roles and activation. Access follows each role's permissions.",
    invite: "Invite member",
    columns: {
      member: "Member",
      role: "Role",
      scope: "Scope",
      lastLogin: "Last sign-in",
      status: "Status",
    },
    active: "Active",
    disabled: "Disabled",
    noPermTitle: "No permission to view this page",
    noPermBody:
      "Accounts & roles is visible to Admin only. Contact a recruitment lead if you need access.",
    actionsPending: "Not yet available",
    roleChanged: (name, role) => `${name} → ${role}`,
  },
  zh: {
    title: "账号与权限",
    subtitle: "管理员工角色和启用状态，访问范围由角色权限决定。",
    invite: "邀请成员",
    columns: {
      member: "成员",
      role: "角色",
      scope: "可见范围",
      lastLogin: "最近登录",
      status: "状态",
    },
    active: "启用",
    disabled: "停用",
    noPermTitle: "无权限访问",
    noPermBody: "账号与权限仅管理员可见。如需开通，请联系招聘负责人。",
    actionsPending: "暂未开放",
    roleChanged: (name, role) => `${name} → ${role}`,
  },
};
