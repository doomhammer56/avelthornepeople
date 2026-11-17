import { SectionHeader } from "@/components/ui/section-header";
import { BrandIcon, type BrandIconName } from "@/components/ui/brand-icon";
import { cn } from "@/lib/utils";
import { revealClass } from "@/lib/publicSite";
import type { HomeContent } from "@/lib/homeContent";
import { homeSectionWithRuleClass } from "./siteSection";

const BENEFIT_ICONS = new Set<BrandIconName>([
  "meaningful-work",
  "learning-growth",
  "collaborative-team",
  "work-life-balance",
  "supportive-culture",
]);

function benefitIcon(name: string): BrandIconName {
  return BENEFIT_ICONS.has(name as BrandIconName)
    ? (name as BrandIconName)
    : "meaningful-work";
}

type Props = {
  eyebrow: string;
  title: string;
  benefits: HomeContent["benefits"];
  className?: string;
};

export function HomeBenefitsSection({
  eyebrow,
  title,
  benefits,
  className,
}: Props) {
  const items = benefits.slice(0, 5);
  if (!items.length) return null;

  return (
    <section
      id="benefits"
      className={cn(homeSectionWithRuleClass, className)}
      aria-labelledby="home-benefits-heading"
    >
      <SectionHeader
        eyebrow={eyebrow}
        title={title}
        headingId="home-benefits-heading"
        titleSize="display"
        align="center"
        className="mb-10 sm:mb-12 lg:mb-16"
      />

      <div className="benefits-grid grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-0 gap-y-10 sm:gap-y-12 lg:gap-y-0">
        {items.map((benefit, index) => (
          <article
            key={benefit.label}
            data-reveal
            className={cn(
              revealClass,
              "flex flex-col items-center gap-4 px-3 text-center sm:gap-5 sm:px-4 lg:px-5 xl:px-6",
              "lg:border-l lg:border-brand-gold/40 lg:first:border-l-0 lg:first:pl-0 lg:last:pr-0",
              index % 2 === 1 && "max-lg:border-l max-lg:border-brand-gold/30",
            )}
          >
            <BrandIcon
              name={benefitIcon(benefit.icon)}
              size={48}
              className="h-12 w-12 shrink-0"
            />
            <h3 className="text-sm sm:text-[15px] font-medium text-brand-navy leading-snug text-balance min-h-[2.75em]">
              {benefit.label}
            </h3>
          </article>
        ))}
      </div>
    </section>
  );
}
