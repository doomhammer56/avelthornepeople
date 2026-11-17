import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AccountPage } from "@/components/AccountPage";
import { accountContent, candidateAccountsEnabled } from "@/lib/accountContent";

type Props = { params: Promise<{ locale: string }> };

// Describe the bilingual signup route while the authentication contract is pending.
// Noindex prevents an unavailable registration screen from entering search results.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!candidateAccountsEnabled) notFound();
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  return {
    title: accountContent[locale].signup,
    robots: { index: false },
    alternates: { languages: { en: "/en/signup", zh: "/zh/signup" } },
  };
}

// Reuse account presentation without creating candidate records or client sessions.
// The backend lead will supply authentication and verification before signup is enabled.
export default async function Page({ params }: Props) {
  if (!candidateAccountsEnabled) notFound();
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  setRequestLocale(locale);
  return <AccountPage locale={locale} mode="signup" />;
}
