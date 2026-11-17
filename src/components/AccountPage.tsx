import type { Locale } from "@/lib/homeContent";
import { homeContent } from "@/lib/homeContent";
import { accountContent } from "@/lib/accountContent";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import {
  accountIntroClass,
  accountLayoutClass,
  eyebrowClass,
  publicSiteClass,
  siteContainerClass,
  skipLinkClass,
} from "@/lib/publicSite";
import { AccountForm } from "./AccountForm";

// Share one public account layout for the two localized authentication entry points.
// Real identity, sessions, verification and account capabilities remain backend-owned.
export function AccountPage({
  locale,
  mode,
}: {
  locale: Locale;
  mode: "login" | "signup";
}) {
  const t = accountContent[locale];
  return (
    <div className={publicSiteClass} data-public-site>
      <a className={skipLinkClass} href="#main-content">
        {locale === "en" ? "Skip to content" : "跳至主要内容"}
      </a>
      <SiteHeader
        locale={locale}
        content={homeContent[locale]}
        activePage="account"
        localePath={`/${mode}`}
      />
      <main className={`${siteContainerClass} ${accountLayoutClass}`} id="main-content">
        <div className={accountIntroClass}>
          <p className={eyebrowClass}>{t.eyebrow}</p>
          <h1>{t[mode]}</h1>
          <p>{t.introduction}</p>
        </div>
        <AccountForm key={`${locale}/${mode}`} locale={locale} mode={mode} />
      </main>
      <SiteFooter locale={locale} content={homeContent[locale]} />
    </div>
  );
}
