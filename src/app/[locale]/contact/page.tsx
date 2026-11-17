import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { ContactPage } from "@/components/contact/ContactPage";
import { contactContent } from "@/lib/contactContent";
import { homeContent, type Locale } from "@/lib/homeContent";
import { getCompanyContent } from "@/server/content/pages";
import { companyHome, shellCompany } from "@/lib/content/public";
import { marketingMetadata } from "@/lib/content/metadata";

type Props = { params: Promise<{ locale: string }> };

async function getLocale(params: Props["params"]) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return locale;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await getLocale(params);
  return marketingMetadata(locale, "contact");
}

export default async function Page({ params }: Props) {
  const locale = await getLocale(params);
  setRequestLocale(locale);
  return (
    <Suspense
      fallback={
        <ContactPage
          locale={locale}
          content={contactContent[locale]}
          siteContent={homeContent[locale]}
          company={shellCompany}
          endpoint="/api/contact"
        />
      }
    >
      <ContactLoaded locale={locale} />
    </Suspense>
  );
}

async function ContactLoaded({ locale }: { locale: Locale }) {
  const company = await getCompanyContent(locale);
  return (
    <ContactPage
      locale={locale}
      content={contactContent[locale]}
      siteContent={companyHome(homeContent[locale], company)}
      company={company}
      endpoint="/api/contact"
    />
  );
}
