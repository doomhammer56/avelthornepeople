import { Headset } from "lucide-react";
import { PublicIntentLink as Link } from "../PublicIntentLink";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { displayHeadingClass } from "@/lib/displayTypography";
import type { Locale } from "@/lib/homeContent";
import { homeSectionWithRuleClass } from "./siteSection";

type Props = {
  locale: Locale;
  title: string;
  description: string;
  ctaLabel: string;
  className?: string;
};

export function HomeConnectSection({
  locale,
  title,
  description,
  ctaLabel,
  className,
}: Props) {
  return (
    <section
      id="connect"
      className={cn(homeSectionWithRuleClass, className)}
      aria-labelledby="home-connect-heading"
    >
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between md:gap-10">
        <div className="min-w-0 max-w-2xl">
          <h2 id="home-connect-heading" className={displayHeadingClass}>
            {title}
          </h2>
          <p className="mt-2 text-sm sm:text-base text-muted-foreground leading-relaxed">
            {description}
          </p>
        </div>

        <Link
          href={`/${locale}/contact`}
          className={cn(
            buttonVariants({ variant: "default", size: "default" }),
            "shrink-0 self-start md:self-center",
          )}
        >
          <Headset className="size-4" aria-hidden />
          {ctaLabel}
        </Link>
      </div>
    </section>
  );
}
