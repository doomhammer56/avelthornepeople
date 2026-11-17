import type { Metadata } from "next";
import { aboutContent } from "../aboutContent.ts";
import { contactContent } from "../contactContent.ts";
import { homeContent } from "../homeContent.ts";
import { servicesContent } from "../servicesContent.ts";
import type { CompanyContent } from "./public.ts";

type MarketingPage = "home" | "about" | "services" | "careers" | "contact";

function clip(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 160);
}

// Approved copy is enough for titles, descriptions and language alternates.
// Search engines then index the page without waiting on the content database.
export function marketingMetadata(
  locale: "en" | "zh",
  page: MarketingPage,
): Metadata {
  const base = homeContent[locale];
  const path = page === "home" ? "" : `/${page}`;
  const title =
    page === "home"
      ? base.brand
      : page === "contact"
        ? `${contactContent[locale].eyebrow} | ${base.brand}`
        : page === "careers"
          ? `${base.careers_eyebrow} | ${base.brand}`
          : `${base.nav[page === "about" ? 1 : 2]} | ${base.brand}`;
  const description = clip(
    page === "home"
      ? base.hero_p2
      : page === "about"
        ? aboutContent[locale].introduction
        : page === "services"
          ? servicesContent[locale].services
              .map((service) => service.description)
              .join(" ")
          : page === "careers"
            ? base.careers_p
            : contactContent[locale].introduction,
  );
  const canonical = `/${locale}${path}`;
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        en: `/en${path}`,
        zh: `/zh${path}`,
        "x-default": `/en${path}`,
      },
    },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      siteName: base.brand,
      locale: locale === "zh" ? "zh_CN" : "en_US",
      alternateLocale: locale === "zh" ? "en_US" : "zh_CN",
      images: [
        {
          url: "/brand/icon-512.png",
          width: 512,
          height: 512,
          alt: base.brand,
        },
      ],
    },
    twitter: { card: "summary", title, description },
  };
}

// Metadata uses the same localized publication as the server-rendered page.
export function companyMetadata(
  page: "home" | "about" | "services",
  locale: "en" | "zh",
  company: CompanyContent,
): Metadata {
  const base = homeContent[locale];
  const block = company.blocks[page === "home" ? "BANNER" : "PROFILE"];
  const services = block?.items.filter((item) => item.kind === "service") ?? [];
  const text =
    page === "services"
      ? services
          .map((item) => `${item.text.title}: ${item.text.body}`)
          .join(" ")
      : (block?.text.body ?? "");
  const description = text.replace(/\s+/g, " ").trim().slice(0, 160);
  const title =
    page === "home"
      ? base.brand
      : `${base.nav[page === "about" ? 1 : 2]} | ${base.brand}`;
  const path = page === "home" ? "" : `/${page}`;
  const canonical = `/${locale}${path}`;
  const available =
    !company.failed && !!block && (page !== "services" || services.length > 0);
  return {
    title,
    ...(description ? { description } : {}),
    alternates: {
      canonical,
      languages: { en: `/en${path}`, zh: `/zh${path}` },
    },
    robots: { index: available, follow: true },
    openGraph: {
      type: "website",
      title,
      description: description || undefined,
      url: canonical,
      siteName: base.brand,
      locale: locale === "zh" ? "zh_CN" : "en_US",
      alternateLocale: locale === "zh" ? "en_US" : "zh_CN",
      ...(block?.image
        ? {
            images: [
              {
                url: block.image.url,
                width: block.image.width,
                height: block.image.height,
                alt: block.text.imageAlt,
              },
            ],
          }
        : {}),
    },
    twitter: { card: "summary", title, description: description || undefined },
  };
}
