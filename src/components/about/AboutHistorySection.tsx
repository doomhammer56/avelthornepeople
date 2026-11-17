import type { AboutContent } from "@/lib/aboutContent";
import type { PublicContentBlock } from "@/lib/content/contract";
import { displayHeadingClass } from "@/lib/displayTypography";
import { CompanyImage } from "../CompanyContentMedia";
import {
  homeSectionClass,
  homeSectionRuleClass,
} from "@/components/home/siteSection";
import { cn } from "cn";
import { revealClass } from "@/lib/publicSite";

type Props = {
  heading: string;
  subheading: string;
  history: AboutContent["history"];
  profile?: PublicContentBlock;
  className?: string;
};

export function AboutHistorySection({
  heading,
  subheading,
  history,
  profile,
  className,
}: Props) {
  if (!history.length) return null;

  const items =
    profile?.items.filter((i) => i.kind === "history" && i.text.label) ?? [];

  return (
    <section
      id="history"
      className={cn(
        homeSectionClass,
        homeSectionRuleClass,
        "grid grid-cols-1 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-10 md:gap-x-16 lg:gap-x-20 items-start",
        className,
      )}
      aria-labelledby="history-heading"
    >
      <div className="flex flex-col gap-2">
        <h2 id="history-heading" className={cn(displayHeadingClass, "m-0")}>
          {heading}
        </h2>
        <p className="m-0 text-sm sm:text-base text-muted-foreground leading-relaxed">
          {subheading}
        </p>
      </div>

      <ol className="m-0 p-0 list-none border-t border-border/80">
        {history.map((item, index) => (
          <li
            key={`${item.year}-${index}`}
            data-reveal
            className={`grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-5 border-b border-border/80 py-5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-x-8 sm:py-6 ${revealClass}`}
          >
            <CompanyImage
              className="col-span-2 mb-3 overflow-hidden rounded-xl"
              image={items[index]?.image}
              alt={items[index]?.text.imageAlt ?? ""}
            />
            <time
              dateTime={item.year}
              className="font-sans text-xl sm:text-2xl font-bold leading-none text-brand-teal tabular-nums pt-0.5"
            >
              {item.year}
            </time>
            <p className="m-0 min-w-0 text-sm sm:text-base leading-relaxed text-muted-foreground whitespace-pre-line">
              {item.description}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
