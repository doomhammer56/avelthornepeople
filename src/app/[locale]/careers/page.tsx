import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { CareersPage } from "@/components/jobs/CareersPage";
import { CareersPending } from "@/components/jobs/PagePending";
import { careersContent } from "@/lib/careersContent";
import { homeContent, type Locale } from "@/lib/homeContent";
import { getPublicJobs } from "@/lib/getPublicJobs";
import { marketingMetadata } from "@/lib/content/metadata";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function getLocale(params: Props["params"]) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return locale;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = await getLocale(params);
  return marketingMetadata(locale, "careers");
}

// The heading renders immediately. Filters and rows wait on the listing query.
export default async function Page({ params, searchParams }: Props) {
  const locale = await getLocale(params);
  setRequestLocale(locale);
  return (
    <Suspense fallback={<CareersPending locale={locale} />}>
      <CareersLoaded locale={locale} searchParams={searchParams} />
    </Suspense>
  );
}

async function CareersLoaded({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Props["searchParams"];
}) {
  const query = await searchParams;
  const paramsForJobs = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (typeof value === "string") paramsForJobs.set(key, value);
  paramsForJobs.set("pageSize", "10");
  paramsForJobs.set("facets", "1");
  const data = await getPublicJobs(paramsForJobs);
  return (
    <CareersPage
      locale={locale}
      content={careersContent[locale]}
      siteContent={homeContent[locale]}
      {...data}
    />
  );
}
