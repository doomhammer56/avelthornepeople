import Link from "next/link";
import { getLocale } from "next-intl/server";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { homeContent } from "@/lib/homeContent";
import { jobDetailContent } from "@/lib/jobDetailContent";
import {
  jobsEmptyClass,
  publicSiteClass,
  siteButtonClass,
  siteContainerClass,
  skipLinkClass,
} from "@/lib/publicSite";

// Offer a translated return path when a role is removed, expired or unknown.
// Unavailable vacancies must not retain stale descriptions or an application action.
export default async function NotFound() {
  const locale = (await getLocale()) === "zh" ? "zh" : "en";
  const t = jobDetailContent[locale];
  return (
    <div className={publicSiteClass} data-public-site>
      <a className={skipLinkClass} href="#main-content">
        {locale === "en" ? "Skip to content" : "跳至主要内容"}
      </a>
      <SiteHeader
        locale={locale}
        content={homeContent[locale]}
        activePage="careers"
      />
      <main className={`${siteContainerClass} ${jobsEmptyClass}`} id="main-content">
        <h1>{t.missingTitle}</h1>
        <p>{t.missingDescription}</p>
        <Link className={siteButtonClass()} href={`/${locale}/careers`}>
          {t.back}
        </Link>
      </main>
      <SiteFooter locale={locale} content={homeContent[locale]} />
    </div>
  );
}
