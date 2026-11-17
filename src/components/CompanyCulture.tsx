import type { HomeContent } from "@/lib/homeContent";
import type { PublicContentBlock } from "@/lib/content/contract";
import { displayHeadingClass } from "@/lib/displayTypography";
import { CompanyFallback } from "./CompanyContentMedia";
import { cn } from "cn";
import { revealClass, siteContainerClass } from "@/lib/publicSite";

/** About culture band: eyebrow + title, then four value columns with gold rules. */
export function CompanyCulture({
  content: t,
  block,
}: {
  content: HomeContent;
  block?: PublicContentBlock;
}) {
  if (!t.values.length) return null;

  return (
    <section
      id="culture"
      className="border-t border-brand-gold/30"
      aria-labelledby="company-culture-heading"
    >
      <div className={`${siteContainerClass} py-16 sm:py-20 lg:py-24`}>
        <div className="mb-10 sm:mb-12 lg:mb-14 flex flex-col gap-3 sm:gap-4">
          <p className="inline-flex items-center gap-2.5 m-0 text-xs font-semibold tracking-[0.14em] uppercase text-foreground/90">
            <span>{t.values_eyebrow}</span>
            <span
              className="inline-block w-8 sm:w-10 h-[1.5px] bg-brand-gold shrink-0"
              aria-hidden
            />
          </p>
          <h2
            id="company-culture-heading"
            className={cn(displayHeadingClass, "m-0")}
          >
            {t.values_h}
          </h2>
          {block?.text.body ? (
            <p className="m-0 max-w-2xl text-sm sm:text-base text-muted-foreground leading-relaxed whitespace-pre-line">
              {block.text.body}
            </p>
          ) : null}
          <CompanyFallback block={block} />
        </div>

        <div className="values-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-y-10 sm:gap-y-12 lg:gap-y-0 lg:divide-x lg:divide-brand-gold/40">
          {t.values.map(([title, description], index) => (
            <article
              key={title}
              data-reveal
              className={cn(
                revealClass,
                "flex flex-col gap-3 sm:gap-4 min-w-0",
                "lg:px-6 xl:px-8",
                index === 0 && "lg:pl-0",
                index === t.values.length - 1 && "lg:pr-0",
              )}
            >
              <h3 className="m-0 font-serif text-xl sm:text-2xl font-semibold tracking-tight text-brand-navy text-balance">
                {title}
              </h3>
              <p className="m-0 text-sm sm:text-base text-muted-foreground leading-relaxed whitespace-pre-line">
                {description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
