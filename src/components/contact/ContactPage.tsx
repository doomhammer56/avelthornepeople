import { MoveRight } from "lucide-react";
import type { ContactContent } from "@/lib/contactContent";
import type { HomeContent, Locale } from "@/lib/homeContent";
import { displayHeadingClass } from "@/lib/displayTypography";
import { PublicIntentLink as Link } from "../PublicIntentLink";
import { buttonVariants } from "@/components/ui/button";
import { BrandIcon, type BrandIconName } from "@/components/ui/brand-icon";
import { ContactForm } from "./ContactForm";
import { SiteFooter } from "../SiteFooter";
import { SiteHeader } from "../SiteHeader";
import { SiteMotion } from "../SiteMotion";
import type { CompanyContent } from "@/lib/content/public";
import { CompanyUnavailable } from "../CompanyContentMedia";
import { PublicJobsRefresh } from "../jobs/PublicJobsRefresh";
import { cn } from "cn";
import { publicSiteClass, siteContainerClass, skipLinkClass } from "@/lib/publicSite";

type Props = {
  locale: Locale;
  content: ContactContent;
  siteContent: HomeContent;
  endpoint: string | null;
  company: CompanyContent;
  preview?: boolean;
};

const enquiryIcons: BrandIconName[] = [
  "business-enquiries",
  "collaborative-team",
];

export function ContactPage({
  locale,
  content,
  siteContent,
  endpoint,
  company,
  preview = false,
}: Props) {
  return (
    <div className={publicSiteClass} data-public-site>
      <a className={skipLinkClass} href="#main-content">
        {locale === "en" ? "Skip to content" : "跳至主要内容"}
      </a>
      <SiteHeader locale={locale} content={siteContent} activePage="contact" />
      <main id="main-content">
        <CompanyUnavailable failed={company.failed} locale={locale} />
        <section
          className={cn(
            siteContainerClass,
            "py-10 sm:py-12 lg:py-16",
            "grid grid-cols-1 items-start gap-10 lg:grid-cols-2 lg:gap-12 xl:gap-16",
          )}
          aria-labelledby="contact-heading"
        >
          <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
            <p className="page-header-eyebrow inline-flex items-center gap-2.5 m-0 text-xs font-semibold tracking-[0.14em] uppercase text-foreground/90">
              <span>{content.eyebrow}</span>
              <span
                className="inline-block h-[1.5px] w-8 shrink-0 bg-brand-gold sm:w-10"
                aria-hidden
              />
            </p>
            <div className="flex flex-col gap-1.5 sm:gap-2">
              <h1
                id="contact-heading"
                className={cn(displayHeadingClass, "m-0")}
              >
                {content.title}
              </h1>
              <p className="m-0 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {content.introduction}
              </p>
            </div>

            <div className="mt-2 flex flex-col border-t border-brand-gold/30">
              {content.enquiries.map((enquiry, index) => {
                const iconName = enquiryIcons[index] ?? "business-enquiries";
                return (
                  <article
                    key={enquiry.label}
                    className={cn(
                      "flex flex-col gap-3 py-6 sm:py-7",
                      index < content.enquiries.length - 1 &&
                        "border-b border-brand-gold/30",
                    )}
                  >
                    <BrandIcon name={iconName} size={40} aria-hidden />
                    <h2 className="m-0 font-serif text-xl font-semibold tracking-tight text-brand-navy/70 sm:text-2xl">
                      {enquiry.label}
                    </h2>
                    <p className="m-0 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
                      {enquiry.description}
                    </p>
                  </article>
                );
              })}
            </div>

            <Link
              href={`/${locale}/careers`}
              prefetch={false}
              className={cn(
                buttonVariants({ variant: "default", size: "default" }),
                "self-start",
              )}
            >
              {content.viewJobs}
              <MoveRight className="size-4" aria-hidden />
            </Link>
          </div>

          {preview ? (
            <div inert className="min-w-0">
              <ContactForm locale={locale} content={content} endpoint={null} />
            </div>
          ) : (
            <ContactForm
              locale={locale}
              content={content}
              endpoint={endpoint}
            />
          )}
        </section>
      </main>
      <SiteFooter locale={locale} content={siteContent} />
      {!preview && <SiteMotion pageKey={`${locale}/contact`} />}
      <PublicJobsRefresh enabled={!preview} />
    </div>
  );
}
