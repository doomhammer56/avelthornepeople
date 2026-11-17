import { homeContent, type Locale } from "./homeContent";
import { getSiteUrl } from "./siteUrl";

// One organization and website, shared by both languages, for rich results.
export function siteJsonLd(locale: Locale) {
  const siteUrl = getSiteUrl();
  const brand = homeContent[locale].brand;
  const origin = siteUrl.toString();
  const orgId = new URL("/#organization", siteUrl).toString();
  const websiteId = new URL("/#website", siteUrl).toString();
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: brand,
        url: origin,
        logo: new URL("/brand/icon-512.png", siteUrl).toString(),
        description: homeContent[locale].hero_p2,
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: brand,
        url: origin,
        inLanguage: ["en", "zh-CN"],
        publisher: { "@id": orgId },
        potentialAction: {
          "@type": "SearchAction",
          target: new URL(
            `/${locale}/careers?q={search_term_string}`,
            siteUrl,
          ).toString(),
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}
