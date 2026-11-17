import { getLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { StatusPanel, StatusLink } from "@/components/StatusPanel";
import { homeContent } from "@/lib/homeContent";
import { publicSiteClass, skipLinkClass } from "@/lib/publicSite";

export default async function NotFound() {
  const locale = (await getLocale()) === "zh" ? "zh" : "en";
  const zh = locale === "zh";
  return (
    <div className={publicSiteClass} data-public-site>
      <a className={skipLinkClass} href="#main-content">
        {zh ? "跳至主要内容" : "Skip to content"}
      </a>
      <SiteHeader
        locale={locale}
        content={homeContent[locale]}
        activePage="none"
        localePath=""
      />
      <StatusPanel
        code="404"
        title={zh ? "找不到此页面" : "Page not found"}
        description={
          zh
            ? "此页面可能已被移除或移动。请返回首页，或查看目前开放的职位。"
            : "This page may have moved or is no longer available. Return home or explore our open roles."
        }
      >
        <StatusLink href={`/${locale}`}>
          {zh ? "返回首页" : "Back to home"}
        </StatusLink>
        <StatusLink href={`/${locale}/careers`} secondary>
          {zh ? "查看职位" : "View open roles"}
        </StatusLink>
      </StatusPanel>
      <SiteFooter locale={locale} content={homeContent[locale]} />
    </div>
  );
}
