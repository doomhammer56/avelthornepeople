import { AdminRequestError } from "./staffClient.ts";
import { adminDataChanged } from "./cacheEvents.ts";
import type { ApplicationQuery } from "../../server/applications/contract.ts";
export function applicationListHref(
  query: ApplicationQuery,
  lang: "en" | "zh",
) {
  const params = new URLSearchParams({
    lang,
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  for (const field of ["jobId", "candidateId", "source", "from", "to"] as const)
    if (query[field]) params.set(field, query[field]!);
  for (const status of query.status) params.append("status", status);
  return `/admin/applications?${params}`;
}
export async function recruitmentRequest<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new AdminRequestError(response.status);
  if (method !== "GET" && path !== "/api/admin/applications/search")
    adminDataChanged("applications");
  return response.json();
}
export const recruitmentContent = {
  en: {
    matches: "Possible candidate matches",
    review: "Review matches",
    compare: "Compare records",
    reason: { both: "Email and phone", email: "Email", phone: "Phone" },
    conflict: "Review required: shared or conflicting contact details.",
    keep: "Keep this candidate",
    merge: "Merge into selected candidate",
    confirm:
      "Merge these candidate records? All applications and CVs will be retained. The selected survivor keeps its profile. This cannot be undone here.",
    failed:
      "Unable to complete this request. Reload to check the latest state before retrying.",
    unavailable:
      "Profile or matching keys are unavailable. Contact the administrator.",
    saved: "Saved.",
    previous: "Previous",
    next: "Next",
    history: "Application history",
    search: "Exact contact search",
    email: "Email",
    phone: "Phone",
    region: "Phone country code (e.g. RW)",
    clear: "Clear search",
    pageExport: "Export this page",
    submitted: "Submitted profile",
    current: "Current candidate profile",
    noMatches: "No matching candidates.",
    results: "Results",
    filters: "Apply filters",
  },
  zh: {
    matches: "可能匹配的候选人",
    review: "查看匹配",
    compare: "比较记录",
    reason: { both: "邮箱和电话", email: "邮箱", phone: "电话" },
    conflict: "需要审核：联系方式可能共享或存在冲突。",
    keep: "保留此候选人",
    merge: "合并到所选候选人",
    confirm:
      "确定合并候选人记录吗？所有投递和简历均会保留，所选候选人的资料保持不变。此处无法撤销。",
    failed: "无法完成此请求。重试前请重新加载以确认最新状态。",
    unavailable: "资料或匹配密钥不可用，请联系管理员。",
    saved: "已保存。",
    previous: "上一页",
    next: "下一页",
    history: "投递历史",
    search: "精确联系方式搜索",
    email: "邮箱",
    phone: "电话",
    region: "电话国家代码（如 RW）",
    clear: "清除搜索",
    pageExport: "导出本页",
    submitted: "提交时的资料",
    current: "当前候选人资料",
    noMatches: "没有匹配的候选人。",
    results: "结果",
    filters: "应用筛选",
  },
} as const;
