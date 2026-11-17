import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { PublicIntentLink as Link } from "../PublicIntentLink";
import type { HomeContent, Locale } from "@/lib/homeContent";
import { siteContainerClass } from "@/lib/publicSite";

type Props = {
  locale: Locale;
  content: Pick<HomeContent, "band_h" | "band_p" | "cta_jobs">;
  heading?: string;
  subheading?: string;
};

export function RecruitmentCta({
  locale,
  content,
  heading,
  subheading,
}: Props) {
  const title = heading || content.band_h || "Find Your Next Opportunity.";
  const desc = subheading !== undefined ? subheading : content.band_p;
  const accent = locale === "zh" ? "机遇" : "Opportunity";
  const accentIndex = title.indexOf(accent);
  const titled =
    accentIndex === -1 ? (
      title
    ) : (
      <>
        {title.slice(0, accentIndex)}
        <span className="text-brand-gold">{title.slice(accentIndex, accentIndex + accent.length)}</span>
        {title.slice(accentIndex + accent.length)}
      </>
    );

  return (
    <section
      className="relative isolate mt-0 w-full overflow-hidden bg-brand-navy text-white"
      aria-label={content.cta_jobs}
    >
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-[58%] sm:w-[50%] lg:w-[46%]"
        aria-hidden
      >
        <Image
          src="/photos/service-technology-1448w.webp"
          alt=""
          fill
          unoptimized
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-brand-navy/55" />
        <div className="absolute inset-0 bg-linear-to-r from-brand-navy via-brand-navy/70 to-brand-navy/25" />
      </div>

      <div className={`${siteContainerClass} relative z-10 py-12 sm:py-14 lg:py-16`}>
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between md:gap-10">
          <div className="min-w-0 max-w-xl lg:max-w-2xl">
            <h2 className="font-serif text-xl sm:text-2xl md:text-[1.75rem] font-semibold tracking-tight text-white leading-tight text-balance">
              {titled}
            </h2>
            {desc ? (
              <p className="mt-2 text-sm sm:text-base text-white/75 leading-relaxed">
                {desc}
              </p>
            ) : null}
          </div>

          <Link
            href={`/${locale}/careers`}
            prefetch={false}
            className="inline-flex shrink-0 items-center gap-2 self-start md:self-center text-sm sm:text-base font-medium text-white underline underline-offset-4 decoration-white/50 hover:decoration-white"
          >
            {content.cta_jobs}
            <ArrowUpRight className="size-4 text-brand-gold" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
