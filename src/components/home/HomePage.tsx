import { careersContent } from "@/lib/careersContent";
import type { HomeContent, Locale } from "@/lib/homeContent";
import type { PublicJobSummary } from "@/lib/publicJobs";
import type { CompanyContent } from "@/lib/content/public";
import { PublicJobsRefresh } from "../jobs/PublicJobsRefresh";
import { SiteHeader } from "../SiteHeader";
import { SiteMotion } from "../SiteMotion";
import { SiteFooter } from "../SiteFooter";
import { HomeCultureSection } from "./HomeCultureSection";
import { HomeConnectSection } from "./HomeConnectSection";
import { CompanyUnavailable } from "../CompanyContentMedia";
import { HomeHeroSection } from "./HomeHeroSection";
import { HomeServicesSection } from "./HomeServicesSection";
import { HomeAboutSection } from "./HomeAboutSection";
import { HomeCareersPreview } from "./HomeCareersPreview";
import { HomeBenefitsSection } from "./HomeBenefitsSection";
import { publicSiteClass, skipLinkClass } from "@/lib/publicSite";

type Props = {
  locale: Locale;
  content: HomeContent;
  jobs: readonly PublicJobSummary[];
  jobsTotal?: number;
  jobsFailed?: boolean;
  company: CompanyContent;
  preview?: boolean;
  /** Paint approved copy before publications and vacancies resolve. */
  shell?: boolean;
};

export function HomePage({
  locale,
  content: t,
  jobs,
  jobsTotal = jobs.length,
  jobsFailed = false,
  company,
  preview = false,
  shell = false,
}: Props) {
  const latestJobs = [...jobs]
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, 6);

  const banner = company.blocks.BANNER;
  const profile = company.blocks.PROFILE;
  // Hide a managed section only when the CMS answered and the section is not
  // published. If the CMS is unreachable the approved fixture copy still shows.
  const showManaged = (type: "PROFILE" | "CULTURE" | "BENEFIT") =>
    shell || company.failed || !!company.blocks[type];

  return (
    <div className={publicSiteClass} id="home" data-public-site>
      <a className={skipLinkClass} href="#main-content">
        {locale === "en" ? "Skip to content" : "跳至主要内容"}
      </a>
      <SiteHeader locale={locale} content={t} />
      <main id="main-content">
        {shell ? null : (
          <CompanyUnavailable failed={company.failed} locale={locale} />
        )}

        <HomeHeroSection
          locale={locale}
          heroLines={t.hero_lines}
          heroLead={t.hero_p}
          heroLead2={t.hero_p2 || undefined}
          image={banner?.image}
          imageAlt={banner?.text.imageAlt}
          ctaJobs={t.cta_jobs}
          ctaAbout={t.cta_about}
        />

        <HomeServicesSection
          eyebrow={t.biz_eyebrow}
          title={t.biz_h}
          services={t.services.map(({ title, description }) => ({
            title,
            description,
          }))}
        />

        {showManaged("PROFILE") ? (
          <HomeAboutSection
            locale={locale}
            eyebrow={t.about_eyebrow}
            title={t.about_h}
            body={t.about_p1}
            bodySecondary={t.about_p2 || undefined}
            ctaLabel={t.more_about}
            ctaHref={`/${locale}/about`}
            image={profile?.image}
            imageAlt={profile?.text.imageAlt}
          />
        ) : null}

        {showManaged("CULTURE") ? (
          <HomeCultureSection
            locale={locale}
            eyebrow={t.values_eyebrow}
            title={t.values_h}
            values={t.values}
          />
        ) : null}

        <HomeCareersPreview
          locale={locale}
          content={t}
          jobs={latestJobs}
          jobsTotal={jobsTotal}
          jobsFailed={jobsFailed}
          emptyMessage={careersContent[locale].empty}
          unavailableMessage={careersContent[locale].unavailableDescription}
          jobsPending={shell}
          pendingMessage={careersContent[locale].loading}
        />

        {showManaged("BENEFIT") ? (
          <HomeBenefitsSection
            eyebrow={t.benefits_eyebrow}
            title={t.benefits_h}
            benefits={t.benefits}
          />
        ) : null}

        <HomeConnectSection
          locale={locale}
          title={t.locations_h}
          description={t.locations_p}
          ctaLabel={t.locations_cta}
        />
      </main>

      <SiteFooter locale={locale} content={t} />
      {!preview && <SiteMotion pageKey={`${locale}/home`} />}
      <PublicJobsRefresh enabled={!preview && !shell} />
    </div>
  );
}
