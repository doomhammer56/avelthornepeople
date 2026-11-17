import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { ChatWidget } from "@/components/chatbot/ChatWidget";
import { serializeJsonLd } from "@/lib/jobPostingSchema";
import { siteJsonLd } from "@/lib/siteSchema";

type Props = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

// Prerender both languages. Child pages can still stream their own dynamic holes.
export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "zh" }];
}

// Public HTML stays fresh for half a minute, then regenerates in the background.
export const revalidate = 30;

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "zh") notFound();
  setRequestLocale(locale);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(siteJsonLd(locale)),
        }}
      />
      {children}
      {/* Public site only: the staff console lives outside this layout. */}
      <ChatWidget lang={locale} />
    </>
  );
}
