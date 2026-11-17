import type { AboutContent } from "@/lib/aboutContent";
import type { HomeContent, Locale } from "@/lib/homeContent";
import { PageHeader } from "@/components/ui/page-header";
import { HomeAboutSection } from "@/components/home/HomeAboutSection";
import { AboutMissionSection } from "@/components/about/AboutMissionSection";
import { AboutHistorySection } from "@/components/about/AboutHistorySection";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { SiteMotion } from "./SiteMotion";
import { CompanyCulture } from "./CompanyCulture";
import { TeamSection } from "./TeamSection";
import type { CompanyContent } from "@/lib/content/public";
import { CompanyFallback, CompanyUnavailable } from "./CompanyContentMedia";
import { PublicJobsRefresh } from "./jobs/PublicJobsRefresh";
import { publicSiteClass, skipLinkClass } from "@/lib/publicSite";

type Props = {
  locale: Locale;
  content: AboutContent;
  siteContent: HomeContent;
  company: CompanyContent;
  preview?: boolean;
};

export function AboutPage({
  locale,
  content,
  siteContent,
  company,
  preview = false,
}: Props) {
  const profile = company.blocks.PROFILE;

  return (
    <div className={publicSiteClass} data-public-site>
      <a className={skipLinkClass} href="#main-content">
        {locale === "en" ? "Skip to content" : "跳至主要内容"}
      </a>
      <SiteHeader locale={locale} content={siteContent} activePage="about" />
      <main id="main-content">
        <CompanyUnavailable failed={company.failed} locale={locale} />
        <PageHeader
          eyebrow={content.eyebrow}
          title={content.title}
          headingId="about-heading"
        >
          <CompanyFallback block={profile} />
        </PageHeader>

        <HomeAboutSection
          locale={locale}
          eyebrow={siteContent.about_h}
          title={siteContent.about_h}
          body={siteContent.about_p1}
          bodySecondary={siteContent.about_p2 || undefined}
          ctaLabel={siteContent.cta_jobs}
          ctaHref={`/${locale}/careers`}
          imagePosition="end"
          showRule={false}
          showCtaArrow={false}
          sectionId="company"
          headingId="about-company-heading"
        />

        <AboutMissionSection
          eyebrow={content.missionEyebrow}
          mission={content.mission}
          profile={profile}
        />

        <AboutHistorySection
          heading={content.historyHeading}
          subheading={content.historySubheading}
          history={content.history}
          profile={profile}
        />

        <TeamSection locale={locale} block={company.blocks.TEAM} />
        <CompanyCulture content={siteContent} block={company.blocks.CULTURE} />
      </main>
      <SiteFooter locale={locale} content={siteContent} />
      {!preview && <SiteMotion pageKey={`${locale}/about`} />}
      <PublicJobsRefresh enabled={!preview} />
    </div>
  );
}
