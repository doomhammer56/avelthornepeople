import type { Locale } from "./homeContent";
import { homeContent } from "./homeContent.ts";
import { jobDetailContent } from "./jobDetailContent.ts";
import type { PublicJobDetail } from "./publicJobSchema";

// Addresses match the offices already named in contactContent and the design handoff.
// Keyed by the English location value so both locales resolve the same office.
const officeAddresses: Record<
  string,
  { addressLocality: string; addressRegion: string; addressCountry: string }
> = {
  "Kuala Lumpur": {
    addressLocality: "Kuala Lumpur",
    addressRegion: "Bangsar South",
    addressCountry: "MY",
  },
  Manila: {
    addressLocality: "Manila",
    addressRegion: "BGC, Taguig",
    addressCountry: "PH",
  },
  London: {
    addressLocality: "London",
    addressRegion: "Shoreditch",
    addressCountry: "GB",
  },
};

// Map the site's bilingual job types to schema.org's fixed employmentType enum.
// Unknown types fall back to OTHER rather than guessing a specific category.
const employmentTypes: Record<string, string> = {
  "Full-time": "FULL_TIME",
  Contract: "CONTRACTOR",
  Internship: "INTERN",
};

// Build the Google for Jobs JobPosting payload for one open vacancy.
// Only called for status "ready" jobs; closed/missing roles are never marked up.
export function buildJobPostingJsonLd(
  job: PublicJobDetail,
  locale: Locale,
  siteUrl: URL,
) {
  const brand = homeContent[locale].brand;
  const label = jobDetailContent[locale];
  const description = [
    `<p>${label.responsibilities}</p>`,
    `<ul>${job.responsibilities[locale].map((line) => `<li>${line}</li>`).join("")}</ul>`,
    `<p>${label.requirements}</p>`,
    `<ul>${job.requirements[locale].map((line) => `<li>${line}</li>`).join("")}</ul>`,
  ].join("");
  const address = officeAddresses[job.location.en];

  return {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title[locale],
    description,
    identifier: { "@type": "PropertyValue", name: brand, value: job.id },
    datePosted: job.postedAt,
    ...(job.closesAt
      ? {
          validThrough:
            job.closesAt.length === 10
              ? `${job.closesAt}T23:59:59+00:00`
              : job.closesAt,
        }
      : {}),
    employmentType:
      job.employmentType ?? employmentTypes[job.type.en] ?? "OTHER",
    hiringOrganization: {
      "@type": "Organization",
      name: brand,
      sameAs: siteUrl.toString(),
    },
    ...(address
      ? {
          jobLocation: {
            "@type": "Place",
            address: { "@type": "PostalAddress", ...address },
          },
        }
      : {}),
    ...(job.showSalary === true && job.salary?.periodCode
      ? {
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: job.salary.currency,
            value: {
              "@type": "QuantitativeValue",
              minValue: job.salary.min,
              maxValue: job.salary.max,
              unitText: job.salary.periodCode,
            },
          },
        }
      : {}),
    directApply: true,
    url: new URL(`/${locale}/jobs/${job.slug}`, siteUrl).toString(),
  };
}

// Serialize for a <script> tag without allowing the content to close it early.
// Also neutralizes any literal "<" so backend-provided text can't inject markup.
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
