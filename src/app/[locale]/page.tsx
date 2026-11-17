import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { HomePage } from "@/components/home";
import { homeContent, type Locale } from "@/lib/homeContent";
import { getPublicJobs } from "@/lib/getPublicJobs";
import { getCompanyContent } from "@/server/content/pages";
import { companyHome, shellCompany } from "@/lib/content/public";
import { marketingMetadata } from "@/lib/content/metadata";

type Props = { params: Promise<{ locale: string }> };

// Validate route input before indexing public content.
// Unknown languages return a 404 rather than silently switching language.
async function getLocale(params: Props["params"]) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return locale;
}

// Titles and descriptions come from approved copy so the document can start
// before the publication and vacancy queries finish.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await getLocale(params);
  return marketingMetadata(locale, "home");
}

export default async function Page({ params }: Props) {
  const locale = await getLocale(params);
  setRequestLocale(locale);
  return (
    <Suspense
      fallback={
        <HomePage
          locale={locale}
          content={homeContent[locale]}
          company={shellCompany}
          jobs={[]}
          shell
        />
      }
    >
      <HomeLoaded locale={locale} />
    </Suspense>
  );
}

async function HomeLoaded({ locale }: { locale: Locale }) {
  const [data, company] = await Promise.all([
    getPublicJobs(new URLSearchParams({ pageSize: "6" })),
    getCompanyContent(locale),
  ]);
  return (
    <HomePage
      locale={locale}
      content={companyHome(homeContent[locale], company)}
      company={company}
      jobs={data.jobs}
      jobsTotal={data.total}
      jobsFailed={data.failed}
    />
  );
}
