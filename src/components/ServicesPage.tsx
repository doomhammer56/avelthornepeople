import type { HomeContent, Locale } from "@/lib/homeContent";
import type { ServicesContent } from "@/lib/servicesContent";
import type { CompanyContent } from "@/lib/content/public";
import { PageHeader } from "@/components/ui/page-header";
import { homeSectionRuleClass } from "@/components/home/siteSection";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { SiteMotion } from "./SiteMotion";
import { CompanyFallback, CompanyUnavailable } from "./CompanyContentMedia";
import { PublicJobsRefresh } from "./jobs/PublicJobsRefresh";
import { ServiceDetailRow } from "./services/ServiceDetailRow";
import { publicSiteClass, siteContainerClass, skipLinkClass } from "@/lib/publicSite";

type Props = {
  locale: Locale;
  content: ServicesContent;
  siteContent: HomeContent;
  company: CompanyContent;
  preview?: boolean;
};

export function ServicesPage({
  locale,
  content,
  siteContent,
  company,
  preview = false,
}: Props) {
  const serviceItems =
    company.blocks.PROFILE?.items.filter((item) => item.kind === "service") ??
    [];

  return (
    <div className={publicSiteClass} data-public-site>
      <a className={skipLinkClass} href="#main-content">
        {locale === "en" ? "Skip to content" : "跳至主要内容"}
      </a>
      <SiteHeader locale={locale} content={siteContent} activePage="services" />
      <main id="main-content">
        <CompanyUnavailable failed={company.failed} locale={locale} />

        <PageHeader
          eyebrow={content.eyebrow}
          title={content.title}
          headingId="services-heading"
        >
          <CompanyFallback block={company.blocks.PROFILE} />
        </PageHeader>

        <section
          id="services"
          className={`${siteContainerClass} py-10 sm:py-12 lg:py-16 ${homeSectionRuleClass}`}
          aria-label={content.eyebrow}
        >
          <div className="divide-y divide-brand-gold/30">
            {content.services.map((service, index) => (
              <ServiceDetailRow
                key={service.title}
                service={service}
                index={index}
                cmsImage={serviceItems[index]?.image}
              />
            ))}
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} content={siteContent} />
      {!preview && <SiteMotion pageKey={`${locale}/services`} />}
      <PublicJobsRefresh enabled={!preview} />
    </div>
  );
}
