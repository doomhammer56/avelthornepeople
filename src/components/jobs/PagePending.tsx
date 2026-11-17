import { careersContent } from "@/lib/careersContent";
import { homeContent, type Locale } from "@/lib/homeContent";
import { jobDetailContent } from "@/lib/jobDetailContent";
import { displayHeadingClass } from "@/lib/displayTypography";
import { siteContainerClass } from "@/lib/publicSite";
import { cn } from "cn";
import { PublicDocument } from "../PublicDocument";
import { SectionSpinner } from "../SectionSpinner";

// Careers heading is static. The listing itself waits on the vacancy query.
export function CareersPending({ locale }: { locale: Locale }) {
  const t = careersContent[locale];
  return (
    <PublicDocument
      locale={locale}
      content={homeContent[locale]}
      activePage="careers"
      pageKey={`${locale}/careers`}
    >
      <section className="bg-site-header-light" aria-labelledby="careers-heading">
        <div
          className={`${siteContainerClass} flex flex-col items-center gap-3 pt-10 pb-10 text-center sm:gap-4 sm:pt-12 sm:pb-12 lg:pt-16 lg:pb-14`}
        >
          <h1 id="careers-heading" className={cn(displayHeadingClass, "m-0 max-w-3xl")}>
            {t.title}
          </h1>
          <p className="m-0 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {t.description}
          </p>
        </div>
      </section>
      <div className={siteContainerClass}>
        <SectionSpinner label={t.loading} />
      </div>
    </PublicDocument>
  );
}

// The vacancy title arrives with the record. Navigation and the back link do not.
export function JobDetailPending({
  locale,
  slug,
}: {
  locale: Locale;
  slug: string;
}) {
  const t = jobDetailContent[locale];
  return (
    <PublicDocument
      locale={locale}
      content={homeContent[locale]}
      activePage="careers"
      localePath={`/jobs/${slug}`}
      pageKey={`${locale}/jobs/${slug}`}
    >
      <div className={`${siteContainerClass} py-10 sm:py-14`}>
        <p className="m-0 text-sm text-muted-foreground">{t.back}</p>
        <SectionSpinner label={t.loading} />
      </div>
    </PublicDocument>
  );
}
