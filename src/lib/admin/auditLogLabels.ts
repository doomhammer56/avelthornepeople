import type {
  AuditEntry,
  SafeAuditChanges,
} from "../../server/audit/contract.ts";
import type { AdminLang } from "./nav.ts";
type Label = { en: string; zh: string };
export const auditActionLabels: Record<string, Label> = {
  DELETION_REQUESTED: { en: "Deletion requested", zh: "提交删除请求" },
  DELETION_VERIFIED: { en: "Deletion request verified", zh: "已核实删除请求" },
  DELETION_REJECTED: { en: "Deletion request rejected", zh: "已拒绝删除请求" },
  DELETION_COMPLETED: { en: "Deletion completed", zh: "已完成删除" },
  PRIVACY_HOLD_SET: { en: "Legal hold applied", zh: "设置法律保留" },
  PRIVACY_HOLD_RELEASED: { en: "Legal hold released", zh: "解除法律保留" },
  PRIVACY_POLICY_CHANGED: {
    en: "Retention policy updated",
    zh: "更新保留政策",
  },
  PERSONAL_DATA_ERASED: { en: "Personal data erased", zh: "已删除个人数据" },
  JOB_CREATE: { en: "Job created", zh: "创建职位" },
  JOB_SAVE: { en: "Job draft saved", zh: "保存职位草稿" },
  JOB_DUPLICATE: { en: "Job duplicated", zh: "复制职位" },
  JOB_SUBMIT: { en: "Job submitted for review", zh: "提交职位审核" },
  JOB_PUBLISH: { en: "Job published", zh: "发布职位" },
  JOB_PAUSE: { en: "Job paused", zh: "暂停职位" },
  JOB_RESUME: { en: "Job resumed", zh: "恢复职位" },
  JOB_CLOSE: { en: "Job closed", zh: "关闭职位" },
  DEV_FIXTURE_SEEDED: {
    en: "Development vacancy created",
    zh: "创建开发测试职位",
  },
  APPLICATION_STAGE_CHANGED: {
    en: "Application stage changed",
    zh: "更新申请阶段",
  },
  CANDIDATES_MERGED: { en: "Candidate records merged", zh: "合并候选人记录" },
  CV_URL_ISSUED: { en: "CV access link issued", zh: "生成简历访问链接" },
  UPDATED: { en: "Record updated", zh: "更新记录" },
  CONFIRMED: { en: "Application confirmed", zh: "确认申请" },
  CONTENT_CREATE: { en: "Content section created", zh: "创建内容区块" },
  CONTENT_SAVE: { en: "Content draft saved", zh: "保存内容草稿" },
  CONTENT_PUBLISH: { en: "Content published", zh: "发布内容" },
  CONTENT_UNPUBLISH: { en: "Content unpublished", zh: "取消发布内容" },
  CONTENT_IMAGE_UPLOADED: { en: "Content image uploaded", zh: "上传内容图片" },
  CONTENT_TEMPLATE_CREATED: {
    en: "Starter content created",
    zh: "创建初始内容",
  },
  CONTENT_SEEDED: {
    en: "Initial company content published",
    zh: "发布初始公司内容",
  },
  STAFF_LINKED: { en: "Staff account linked", zh: "关联员工账号" },
  STAFF_CHANGED: { en: "Staff access changed", zh: "更新员工权限" },
  STAFF_DELETED: { en: "Staff account deleted", zh: "删除员工账号" },
  STAFF_RENAMED: { en: "Staff name changed", zh: "修改员工姓名" },
  STAFF_BOOTSTRAPPED: {
    en: "Administrator account created",
    zh: "创建管理员账号",
  },
  STAFF_PROVIDER_SYNCED: {
    en: "Staff access synchronized",
    zh: "同步员工权限",
  },
  PASSWORD_CHANGED: { en: "Password changed", zh: "修改密码" },
  PASSWORD_CHANGE_UNCERTAIN: {
    en: "Password change needs verification",
    zh: "密码修改待确认",
  },
  DEPARTMENT_CREATED: { en: "Department created", zh: "创建部门" },
  JOB_OPTION_CREATED: { en: "Job option created", zh: "创建职位选项" },
  JOB_OPTION_UPDATED: { en: "Job option updated", zh: "更新职位选项" },
  DEPARTMENT_UPDATED: { en: "Department updated", zh: "更新部门" },
  DEPARTMENT_DELETED: { en: "Department deleted", zh: "删除部门" },
  LOCATION_CREATED: { en: "Location created", zh: "创建办公地点" },
  LOCATION_UPDATED: { en: "Location updated", zh: "更新办公地点" },
  LOCATION_DELETED: { en: "Location deleted", zh: "删除办公地点" },
  CONTACT_MESSAGE_CREATED: {
    en: "Contact message created",
    zh: "创建联系记录",
  },
  CONTACT_MESSAGE_UPDATED: {
    en: "Contact message updated",
    zh: "更新联系记录",
  },
  CONTACT_MESSAGE_DELETED: {
    en: "Contact message deleted",
    zh: "删除联系记录",
  },
};
export const auditObjectLabels: Record<string, Label> = {
  PRIVACY_REQUEST: { en: "Deletion request", zh: "删除请求" },
  PRIVACY_POLICY: { en: "Retention policy", zh: "保留政策" },
  PRIVACY_HOLD: { en: "Legal hold", zh: "法律保留" },
  PRIVACY_ERASURE: { en: "Erasure receipt", zh: "删除凭证" },
  JOB: { en: "Job", zh: "职位" },
  APPLICATION: { en: "Application record", zh: "申请记录" },
  CANDIDATE: { en: "Candidate record", zh: "候选人记录" },
  CONTENT: { en: "Company content", zh: "公司内容" },
  CONTENT_IMAGE: { en: "Content image", zh: "内容图片" },
  STAFF_PROFILE: { en: "Staff account", zh: "员工账号" },
  AUTH_ACCOUNT: { en: "Staff account", zh: "员工账号" },
  DEPARTMENT: { en: "Department", zh: "部门" },
  LOCATION: { en: "Location", zh: "办公地点" },
  JOB_OPTION: { en: "Job option", zh: "职位选项" },
  CONTACT_MESSAGE: { en: "Contact message", zh: "联系记录" },
};
const detailLabels: Record<string, Label> = {
  version: { en: "Revision", zh: "版本" },
  applicationsMoved: { en: "Applications moved", zh: "已转移申请数" },
  status: { en: "Stage / status", zh: "阶段／状态" },
  intakeState: { en: "Intake status", zh: "接收状态" },
  role: { en: "Role", zh: "角色" },
  oldRole: { en: "Previous role", zh: "原角色" },
  active: { en: "Active", zh: "已启用" },
  oldActive: { en: "Previously active", zh: "原启用状态" },
  reason: { en: "Reason", zh: "原因" },
  operation: { en: "Access update", zh: "权限更新" },
  fields: { en: "Changed fields", zh: "变更字段" },
};
const fieldLabels: Record<string, Label> = {
  code: { en: "Code", zh: "代码" },
  name_en: { en: "English name", zh: "英文名称" },
  name_zh: { en: "Chinese name", zh: "中文名称" },
  active: { en: "Active", zh: "启用状态" },
  sort_order: { en: "Order", zh: "排序" },
  address_en: { en: "English address", zh: "英文地址" },
  address_zh: { en: "Chinese address", zh: "中文地址" },
  country_code: { en: "Country", zh: "国家" },
  timezone: { en: "Time zone", zh: "时区" },
  state: { en: "Status", zh: "状态" },
  assigned_to: { en: "Assignee", zh: "负责人" },
};
const values: Record<string, Label> = {
  ADMIN: { en: "Administrator", zh: "管理员" },
  HR: { en: "HR", zh: "人力资源" },
  READ_ONLY: { en: "Read only", zh: "只读" },
  DRAFT: { en: "Draft", zh: "草稿" },
  PENDING_REVIEW: { en: "Pending review", zh: "待审核" },
  PUBLISHED: { en: "Published", zh: "已发布" },
  PAUSED: { en: "Paused", zh: "已暂停" },
  CLOSED: { en: "Closed", zh: "已关闭" },
  NEW: { en: "New", zh: "新申请" },
  SCREENING: { en: "Screening", zh: "筛选中" },
  INTERVIEW: { en: "Interview", zh: "面试" },
  OFFER: { en: "Offer", zh: "已发录用通知" },
  REJECTED: { en: "Rejected", zh: "已拒绝" },
  CONFIRMED: { en: "Confirmed", zh: "已确认" },
  EXPIRED: { en: "Posting expired", zh: "职位已到期" },
  ban: { en: "Disabled", zh: "已禁用" },
  unban: { en: "Enabled", zh: "已启用" },
};
export function auditActionLabel(action: string, lang: AdminLang) {
  return (
    auditActionLabels[action]?.[lang] ??
    (lang === "en" ? "Historical action" : "历史操作")
  );
}
export function auditObjectLabel(entry: AuditEntry, lang: AdminLang) {
  return (
    entry.objectLabel?.[lang] ??
    auditObjectLabels[entry.objectType]?.[lang] ??
    (lang === "en" ? "Record" : "记录")
  );
}
export function auditDetailLines(
  changes: SafeAuditChanges,
  lang: AdminLang,
): string[] {
  return Object.entries(changes).flatMap(([key, value]) => {
    const title = detailLabels[key]?.[lang];
    if (!title || value === null) return [];
    const readable = Array.isArray(value)
      ? value
          .map((field) => fieldLabels[field]?.[lang] ?? field)
          .join(lang === "zh" ? "、" : ", ")
      : typeof value === "boolean"
        ? lang === "en"
          ? value
            ? "Yes"
            : "No"
          : value
            ? "是"
            : "否"
        : (values[String(value)]?.[lang] ?? String(value));
    return [`${title}: ${readable}`];
  });
}
