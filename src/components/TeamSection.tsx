import Image from "next/image";
import type { Locale } from "@/lib/homeContent";
import type { PublicContentBlock } from "@/lib/content/contract";
import { teamContent } from "@/lib/teamContent";
import { displayHeadingClass } from "@/lib/displayTypography";
import { CompanyFallback } from "./CompanyContentMedia";
import {
  homeSectionClass,
  homeSectionRuleClass,
} from "@/components/home/siteSection";
import { cn } from "cn";
import { revealClass } from "@/lib/publicSite";

type Props = {
  locale: Locale;
  block?: PublicContentBlock;
  className?: string;
};

export function TeamSection({ locale, block, className }: Props) {
  const base = teamContent[locale];
  const title = block?.text.title || base.title;
  const eyebrow = block?.text.eyebrow || base.eyebrow;
  const description = block?.text.body || base.description;
  const photo = block?.image
    ? {
        src: block.image.url,
        alt: block.text.imageAlt || base.imageAlt,
      }
    : {
        src: "/photos/team-culture-1672w.webp",
        alt: base.imageAlt,
      };

  return (
    <section
      id="team"
      className={cn(homeSectionClass, homeSectionRuleClass, className)}
      aria-labelledby="team-heading"
    >
      <div data-reveal className={`mb-10 flex max-w-3xl flex-col gap-3 sm:mb-12 sm:gap-4 lg:mb-14 ${revealClass}`}>
        <p className="inline-flex items-center gap-2.5 m-0 text-xs font-semibold tracking-[0.14em] uppercase text-foreground/90">
          <span>{eyebrow}</span>
          <span
            className="inline-block w-8 sm:w-10 h-[1.5px] bg-brand-gold shrink-0"
            aria-hidden
          />
        </p>
        <h2 id="team-heading" className={cn(displayHeadingClass, "m-0")}>
          {title}
        </h2>
        <p className="m-0 text-sm sm:text-base text-foreground/80 leading-relaxed max-w-2xl whitespace-pre-line">
          {description}
        </p>
        <CompanyFallback block={block} />
      </div>

      <div
        data-reveal
        className={`relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-secondary sm:aspect-[2/1] ${revealClass}`}
      >
        <Image
          src={photo.src}
          alt={photo.alt}
          fill
          unoptimized
          sizes="(max-width: 1200px) 100vw, 1200px"
          className="object-cover object-center"
        />
      </div>
    </section>
  );
}
