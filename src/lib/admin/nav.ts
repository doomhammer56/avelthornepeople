import { can, type StaffRole, type Permission } from "../auth/permissions.ts";

export type AdminLang = "en" | "zh";
export type NavIcon =
  | "dashboard"
  | "jobs"
  | "applications"
  | "content"
  | "log"
  | "accounts"
  | "settings";

type NavItem = {
  key: string;
  href: string;
  icon: NavIcon;
  label: Record<AdminLang, string>;
  /** Match the server's data-access roles on every navigation surface. */
  permission: Permission;
};

type NavGroup = {
  key: string;
  label: Record<AdminLang, string>;
  items: NavItem[];
};

// Mirrors the handoff's four sidebar groups (Overview / Recruiting / Website / System).
// Routes are added as each screen is built; unbuilt ones simply aren't linked yet.
export const adminNavGroups: NavGroup[] = [
  {
    key: "overview",
    label: { en: "Overview", zh: "概览" },
    items: [
      {
        key: "dashboard",
        permission: "dashboard.read",
        href: "/admin",
        icon: "dashboard",
        label: { en: "Dashboard", zh: "数据看板" },
      },
    ],
  },
  {
    key: "recruiting",
    label: { en: "Recruiting", zh: "招聘" },
    items: [
      {
        key: "jobs",
        permission: "jobs.read",
        href: "/admin/jobs",
        icon: "jobs",
        label: { en: "Jobs", zh: "职位管理" },
      },
      {
        key: "applications",
        permission: "applications.read",
        href: "/admin/applications",
        icon: "applications",
        label: { en: "Applications", zh: "投递管理" },
      },
    ],
  },
  {
    key: "website",
    label: { en: "Website", zh: "官网" },
    items: [
      {
        key: "content",
        permission: "content.read",
        href: "/admin/content",
        icon: "content",
        label: { en: "Content", zh: "公司内容" },
      },
    ],
  },
  {
    key: "system",
    label: { en: "System", zh: "系统" },
    items: [
      {
        key: "log",
        permission: "audit.read",
        href: "/admin/log",
        icon: "log",
        label: { en: "Audit Log", zh: "操作日志" },
      },
      {
        key: "accounts",
        permission: "team.read",
        href: "/admin/accounts",
        icon: "accounts",
        label: { en: "Accounts & Roles", zh: "账号与权限" },
      },
      {
        key: "settings",
        permission: "settings.read",
        href: "/admin/settings",
        icon: "settings",
        label: { en: "Settings", zh: "系统设置" },
      },
    ],
  },
];

// Keep role filtering in one place so every nav-rendering surface stays in sync.
// A group with no visible items for the current role is dropped entirely.
export function visibleNavGroups(role: StaffRole): NavGroup[] {
  return adminNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => can(role, item.permission)),
    }))
    .filter((group) => group.items.length > 0);
}

export const roleLabel: Record<StaffRole, Record<AdminLang, string>> = {
  ADMIN: { en: "Admin", zh: "管理员" },
  HR: { en: "HR", zh: "HR" },
  READ_ONLY: { en: "Read-only", zh: "只读" },
};

export function adminLanguageHref(href: string, lang: AdminLang) {
  const url = new URL(href, "https://console.invalid");
  url.searchParams.set("lang", lang);
  return `${url.pathname}${url.search}${url.hash}`;
}

// One title per nav destination, shown in the top bar instead of a static
// "Avelthorne People Group" breadcrumb that never changed between screens.
export function pageTitle(pathname: string, lang: AdminLang): string {
  for (const group of adminNavGroups)
    for (const item of group.items)
      if (
        pathname === item.href ||
        (item.href !== "/admin" && pathname.startsWith(`${item.href}/`))
      )
        return item.label[lang];
  return lang === "zh" ? "招聘管理后台" : "Staff Console";
}
