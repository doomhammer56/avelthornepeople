import type { ReactNode } from "react";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { SiteMotion } from "./SiteMotion";
import type { HomeContent, Locale } from "@/lib/homeContent";
import { publicSiteClass, skipLinkClass } from "@/lib/publicSite";

type Props = {
  locale: Locale;
  content: HomeContent;
  activePage?:
    | "home"
    | "about"
    | "services"
    | "careers"
    | "contact"
    | "account"
    | "none";
  localePath?: string;
  languageQuery?: string;
  pageKey: string;
  children: ReactNode;
};

// Shared public chrome so a streamed page can paint navigation before its data.
export function PublicDocument({
  locale,
  content,
  activePage = "home",
  localePath,
  languageQuery = "",
  pageKey,
  children,
}: Props) {
  return (
    <div className={publicSiteClass} data-public-site>
      <a className={skipLinkClass} href="#main-content">
        {locale === "en" ? "Skip to content" : "跳至主要内容"}
      </a>
      <SiteHeader
        locale={locale}
        content={content}
        activePage={activePage}
        localePath={localePath}
        languageQuery={languageQuery}
      />
      <main id="main-content">{children}</main>
      <SiteFooter locale={locale} content={content} />
      <SiteMotion pageKey={pageKey} />
    </div>
  );
}
