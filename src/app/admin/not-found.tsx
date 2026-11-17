import { authLanguage } from "@/server/auth/pages";
import { StatusPanel, StatusLink } from "@/components/StatusPanel";
import { publicSiteClass } from "@/lib/publicSite";

export default async function AdminNotFound() {
  const lang = await authLanguage();
  return (
    <div className={publicSiteClass} data-public-site>
      <StatusPanel
        code="404"
        title={lang === "zh" ? "找不到此页面" : "Page not found"}
        description={
          lang === "zh"
            ? "此页面或记录可能已被移除。请返回工作台后重试。"
            : "This page or record may have been removed. Return to the console to continue."
        }
      >
        <StatusLink href={`/admin?lang=${lang}`}>
          {lang === "zh" ? "返回工作台" : "Back to console"}
        </StatusLink>
        <StatusLink href={`/${lang}`} secondary>
          {lang === "zh" ? "查看官网" : "View public site"}
        </StatusLink>
      </StatusPanel>
    </div>
  );
}
