export const staffRoles = ["ADMIN", "HR", "READ_ONLY"] as const;
export type StaffRole = (typeof staffRoles)[number];
const all = staffRoles;
const recruiting = ["ADMIN", "HR"] as const;
const admin = ["ADMIN"] as const;

export const permissions = {
  "console.read": all,
  "dashboard.read": recruiting,
  "jobs.read": all,
  "jobs.write": recruiting,
  "jobs.publish": admin,
  "lookups.read": all,
  "applications.read": recruiting,
  "applications.write": recruiting,
  "cv.read": recruiting,
  "content.read": all,
  "content.write": admin,
  "audit.read": admin,
  "team.read": admin,
  "team.manage": admin,
  "settings.read": admin,
  "settings.write": admin,
  "privacy.manage": admin,
} as const satisfies Record<string, readonly StaffRole[]>;
export type Permission = keyof typeof permissions;
export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && staffRoles.some((role) => role === value);
}
export function rolesFor(permission: Permission): readonly StaffRole[] {
  return Object.hasOwn(permissions, permission) ? permissions[permission] : [];
}
export function can(role: unknown, permission: Permission): boolean {
  return isStaffRole(role) && rolesFor(permission).includes(role);
}
export const roleScope = {
  ADMIN: {
    en: "All administrative modules and team management",
    zh: "所有管理模块及团队管理",
  },
  HR: {
    en: "Dashboard, jobs and recruitment; content inspection",
    zh: "看板、职位与招聘管理；查看公司内容",
  },
  READ_ONLY: { en: "View jobs and company content", zh: "查看职位及公司内容" },
} as const;
