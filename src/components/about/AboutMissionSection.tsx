import type { AboutContent } from "@/lib/aboutContent";
import type { PublicContentBlock } from "@/lib/content/contract";
import { CompanyImage } from "../CompanyContentMedia";
import { homeSectionClass } from "@/components/home/siteSection";
import { cn } from "cn";
import { revealClass } from "@/lib/publicSite";

type Props = {
  eyebrow: string;
  mission: AboutContent["mission"];
  profile?: PublicContentBlock;
  className?: string;
};

export function AboutMissionSection({
  eyebrow,
  mission,
  profile,
  className,
}: Props) {
  if (!mission.length) return null;

  const items =
    profile?.items.filter(
      (i) => (i.kind === "mission" || i.kind === "card") && i.text.title,
    ) ?? [];

  return (
    <section
      id="mission"
      className={cn(
        homeSectionClass,
        "border-y border-brand-gold/30",
        className,
      )}
      aria-labelledby="mission-heading"
    >
      <h2 id="mission-heading" className="sr-only">
        {eyebrow}
      </h2>
      <p className="mb-10 sm:mb-12 lg:mb-14 inline-flex items-center gap-2.5 m-0 text-xs font-semibold tracking-[0.14em] uppercase text-foreground/90">
        <span>{eyebrow}</span>
        <span
          className="inline-block w-8 sm:w-10 h-[1.5px] bg-brand-gold shrink-0"
          aria-hidden
        />
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x md:divide-brand-gold/40 gap-10 md:gap-0">
        {mission.map((item, index) => (
          <article
            key={item.label}
            data-reveal
            className={cn(
              revealClass,
              "flex flex-col gap-4 sm:gap-5",
              index === 0
                ? "md:pr-10 lg:pr-16 xl:pr-20"
                : "md:pl-10 lg:pl-16 xl:pl-20",
            )}
          >
            <CompanyImage
              image={items[index]?.image}
              alt={items[index]?.text.imageAlt ?? ""}
              className="overflow-hidden rounded-xl"
            />
            <h3 className="m-0 font-serif text-2xl sm:text-3xl lg:text-[2rem] font-semibold tracking-tight text-brand-navy text-balance">
              {item.label}
            </h3>
            <p className="m-0 max-w-md text-sm sm:text-base text-foreground/80 leading-relaxed whitespace-pre-line">
              {item.statement}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
