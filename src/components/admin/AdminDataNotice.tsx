import { CircleAlert, Info } from "lucide-react";
import type { AdminLang } from "@/lib/admin/nav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AdminRefreshButton } from "./AdminRefreshButton";

export const adminDataText = {
  en: {
    restricted: "Your staff role does not have access to this information.",
    unavailable:
      "This information is temporarily unavailable. Please reload to retry.",
    readOnly:
      "Database records are shown below. Editing and publishing are not available yet.",
    unimplemented:
      "This workflow is not connected yet. No changes will be saved.",
    profilePending:
      "Applicant details are currently unavailable. You can still view submission information and download available CVs.",
    empty: "No records found.",
  },
  zh: {
    restricted: "您的员工角色无权访问这些信息。",
    unavailable: "信息暂时不可用，请刷新页面重试。",
    readOnly: "下方显示数据库记录，编辑和发布功能尚未开放。",
    unimplemented: "此流程尚未连接，修改不会被保存。",
    profilePending: "申请人资料暂不可用，您仍可查看投递信息并下载可用的简历。",
    empty: "暂无记录。",
  },
};
export function AdminDataNotice({
  lang,
  kind,
}: {
  lang: AdminLang;
  kind: keyof typeof adminDataText.en;
}) {
  const problem = kind === "unavailable" || kind === "restricted";
  const Icon = problem ? CircleAlert : Info;
  return (
    <Alert variant={problem ? "destructive" : "default"} role={problem ? "alert" : "status"}>
      <Icon aria-hidden="true" />
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{adminDataText[lang][kind]}</span>
        {kind === "unavailable" && (
          <AdminRefreshButton label={lang === "zh" ? "重试" : "Retry"} />
        )}
      </AlertDescription>
    </Alert>
  );
}
