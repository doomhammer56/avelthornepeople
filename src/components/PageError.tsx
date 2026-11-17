"use client";

import { useParams, usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { StatusPanel, StatusLink } from "./StatusPanel";
import { publicSiteClass, siteButtonClass } from "@/lib/publicSite";

const subscribe = () => () => {};
const documentLanguage = () => document.documentElement.lang;
const serverLanguage = () => "en";

export function PageError({ retry }: { retry: () => void }) {
  const params = useParams();
  const pathname = usePathname();
  const documentLang = useSyncExternalStore(
    subscribe,
    documentLanguage,
    serverLanguage,
  );
  const lang =
    params?.locale === "zh" || documentLang.startsWith("zh") ? "zh" : "en";
  const admin = pathname?.startsWith("/admin");
  return (
    <div className={publicSiteClass} data-public-site>
      <title>
        {lang === "zh"
          ? "页面暂时不可用 | Avelthorne People Group"
          : "Page unavailable | Avelthorne People Group"}
      </title>
      <meta name="robots" content="noindex" />
      <StatusPanel
        code="500"
        title={
          lang === "zh" ? "暂时无法加载页面" : "We could not load this page"
        }
        description={
          lang === "zh"
            ? "请重试，或返回首页继续浏览。"
            : "Please try again, or return to the start page to continue."
        }
      >
        <button className={siteButtonClass()} type="button" onClick={retry}>
          {lang === "zh" ? "重试" : "Try again"}
        </button>
        <StatusLink href={admin ? `/admin?lang=${lang}` : `/${lang}`} secondary>
          {admin
            ? lang === "zh"
              ? "返回工作台"
              : "Back to console"
            : lang === "zh"
              ? "返回首页"
              : "Back to home"}
        </StatusLink>
      </StatusPanel>
    </div>
  );
}
