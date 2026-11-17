import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { ServicesPage } from "@/components/ServicesPage";
import { homeContent, type Locale } from "@/lib/homeContent";
import { servicesContent } from "@/lib/servicesContent";
import { getCompanyContent } from "@/server/content/pages";
import { companyServices, companyHome, shellCompany } from "@/lib/content/public";
import { marketingMetadata } from "@/lib/content/metadata";

type Props = { params: Promise<{ locale: string }> };

async function getLocale(params: Props["params"]) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return locale;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await getLocale(params);
  return marketingMetadata(locale, "services");
}

export default async function Page({ params }: Props) {
  const locale = await getLocale(params);
  setRequestLocale(locale);
  return (
    <Suspense
      fallback={
        <ServicesPage
          locale={locale}
          content={servicesContent[locale]}
          siteContent={homeContent[locale]}
          company={shellCompany}
        />
      }
    >
      <ServicesLoaded locale={locale} />
    </Suspense>
  );
}

async function ServicesLoaded({ locale }: { locale: Locale }) {
  const company = await getCompanyContent(locale);
  return (
    <ServicesPage
      locale={locale}
      content={companyServices(servicesContent[locale], company)}
      siteContent={companyHome(homeContent[locale], company)}
      company={company}
    />
  );
}
