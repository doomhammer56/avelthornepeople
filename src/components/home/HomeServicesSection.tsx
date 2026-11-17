import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/utils";
import { revealClass } from "@/lib/publicSite";
import { homeSectionWithRuleClass } from "./siteSection";

export type HomeServiceItem = {
  title: string;
  description: string;
};

type Props = {
  eyebrow: string;
  title: string;
  services: readonly HomeServiceItem[];
  className?: string;
};

export function HomeServicesSection({
  eyebrow,
  title,
  services,
  className,
}: Props) {
  if (!services.length) return null;

  return (
    <section
      id="services"
      className={cn(homeSectionWithRuleClass, className)}
      aria-labelledby="services-heading"
    >
      <SectionHeader
        eyebrow={eyebrow}
        title={title}
        headingId="services-heading"
        titleSize="display"
        align="center"
        className="mb-10 sm:mb-12 lg:mb-14"
      />

      <div className="home-services-grid grid grid-cols-1 md:grid-cols-3 gap-y-16 md:gap-y-0 md:divide-x md:divide-brand-gold/35">
        {services.map((service, index) => (
          <article
            key={service.title}
            data-reveal
            className={`flex flex-col space-y-4 sm:space-y-5 md:px-8 md:first:pl-0 md:last:pr-0 lg:px-10 ${revealClass}`}
          >
            <span
              className="font-sans text-xs sm:text-[13px] font-light tracking-[0.28em] text-brand-teal/70 tabular-nums"
              aria-hidden
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="font-serif text-xl sm:text-2xl font-semibold text-brand-navy tracking-tight text-balance">
              {service.title}
            </h3>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              {service.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
