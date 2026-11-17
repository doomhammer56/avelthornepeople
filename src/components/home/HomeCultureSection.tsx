import { ArrowUpRight } from "lucide-react";
import { PublicIntentLink as Link } from "../PublicIntentLink";
import { SectionHeader } from "@/components/ui/section-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { revealClass } from "@/lib/publicSite";
import type { Locale } from "@/lib/homeContent";
import { homeSectionClass } from "./siteSection";

export type HomeCultureValue = readonly [string, string] | readonly string[];

type Props = {
  locale: Locale;
  eyebrow: string;
  title: string;
  values: readonly HomeCultureValue[];
  className?: string;
};

export function HomeCultureSection({
  locale,
  eyebrow,
  title,
  values,
  className,
}: Props) {
  if (!values.length) return null;

  return (
    <section
      id="culture"
      className={cn(
        "w-full border-t border-brand-gold/30 bg-site-header",
        className,
      )}
      aria-labelledby="culture-heading"
    >
      <div className={homeSectionClass}>
        <SectionHeader
          eyebrow={eyebrow}
          title={title}
          headingId="culture-heading"
          titleSize="display"
          className="mb-8 sm:mb-10 lg:mb-12"
          action={
            <Link
              href={`/${locale}/about#culture`}
              aria-label={
                locale === "zh" ? "了解企业文化" : "Learn about our culture"
              }
              className={cn(
                buttonVariants({ variant: "outline", size: "icon-sm" }),
                "size-9 rounded-full border-brand-navy text-brand-navy bg-transparent hover:bg-transparent hover:border-brand-navy hover:text-brand-navy",
              )}
            >
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          }
        />

        <div className="home-culture-values grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 sm:gap-x-8 lg:gap-x-10 gap-y-10 sm:gap-y-12">
          {values.map((value) => {
            const valueTitle = value[0] ?? "";
            const description = value[1] ?? "";
            if (!valueTitle) return null;
            return (
              <article
                key={valueTitle}
                data-reveal
                className={`flex min-w-0 flex-col space-y-3 sm:space-y-4 ${revealClass}`}
              >
                <h3 className="font-serif text-xl sm:text-2xl font-semibold text-brand-navy tracking-tight text-balance">
                  {valueTitle}
                </h3>
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                  {description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
