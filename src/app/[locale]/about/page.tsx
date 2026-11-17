import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AboutPage } from "@/components/AboutPage";
import { getCompanyContent } from "@/server/content/pages";
import { companyHome, companyAbout, shellCompany } from "@/lib/content/public";
import { aboutContent } from "@/lib/aboutContent";
import { homeContent, type Locale } from "@/lib/homeContent";
import { marketingMetadata } from "@/lib/content/metadata";

type Props = { params: Promise<{ locale: string }> };

async function getLocale(params: Props["params"]) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return locale;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await getLocale(params);
  return marketingMetadata(locale, "about");
}

export default async function Page({ params }: Props) {
  const locale = await getLocale(params);
  setRequestLocale(locale);
  return (
    <Suspense
      fallback={
        <AboutPage
          locale={locale}
          content={aboutContent[locale]}
          siteContent={homeContent[locale]}
          company={shellCompany}
        />
      }
    >
      <AboutLoaded locale={locale} />
    </Suspense>
  );
}

async function AboutLoaded({ locale }: { locale: Locale }) {
  const company = await getCompanyContent(locale);
  return (
    <AboutPage
      locale={locale}
      content={companyAbout(aboutContent[locale], company)}
      siteContent={companyHome(homeContent[locale], company)}
      company={company}
    />
  );
}
