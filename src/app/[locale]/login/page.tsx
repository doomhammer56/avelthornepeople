import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AccountPage } from "@/components/AccountPage";
import { accountContent, candidateAccountsEnabled } from "@/lib/accountContent";

type Props = { params: Promise<{ locale: string }> };

// Describe public account entry pages without indexing an unavailable account service.
// Both language versions remain directly reachable through the shared language switch.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!candidateAccountsEnabled) notFound();
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return {
    title: accountContent[locale].login,
    robots: { index: false },
    alternates: { languages: { en: "/en/login", zh: "/zh/login" } },
  };
}

// Validate the locale before rendering the shared frontend-only account form.
// No authentication provider or database operation runs in this route.
export default async function Page({ params }: Props) {
  if (!candidateAccountsEnabled) notFound();
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  setRequestLocale(locale);
  return <AccountPage locale={locale} mode="login" />;
}
