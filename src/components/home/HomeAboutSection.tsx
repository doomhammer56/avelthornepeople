import Image from "next/image";
import { MoveRight } from "lucide-react";
import { PublicIntentLink as Link } from "../PublicIntentLink";
import { SectionHeader } from "@/components/ui/section-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ContentImage } from "@/lib/content/contract";
import type { Locale } from "@/lib/homeContent";
import { homeSectionClass, homeSectionWithRuleClass } from "./siteSection";

type Props = {
  locale: Locale;
  eyebrow: string;
  title: string;
  body: string;
  bodySecondary?: string;
  ctaLabel: string;
  ctaHref: string;
  /** Image first (home) or copy first (about). */
  imagePosition?: "start" | "end";
  showRule?: boolean;
  showCtaArrow?: boolean;
  sectionId?: string;
  headingId?: string;
  className?: string;
  /** Published PROFILE photograph; the approved collaboration photo is the default. */
  image?: ContentImage | null;
  imageAlt?: string;
};

export function HomeAboutSection({
  locale,
  eyebrow,
  title,
  body,
  bodySecondary,
  ctaLabel,
  ctaHref,
  imagePosition = "start",
  showRule = true,
  showCtaArrow = true,
  sectionId = "about",
  headingId = "home-about-heading",
  className,
  image: cmsImage,
  imageAlt,
}: Props) {
  const image = (
    <div className="relative min-h-[280px] sm:min-h-[320px] lg:min-h-[380px] overflow-hidden rounded-xl bg-secondary">
      <Image
        src={cmsImage?.url ?? "/photos/company-collaboration-1280w.webp"}
        alt={
          (cmsImage && imageAlt) ||
          (locale === "zh"
            ? "三位同事在现代办公环境中专注讨论"
            : "Three colleagues in a focused workplace discussion.")
        }
        fill
        unoptimized
        sizes="(max-width: 1024px) 100vw, 50vw"
        className="object-cover object-center"
      />
    </div>
  );

  const copy = (
    <div className="flex max-w-xl flex-col gap-5 sm:gap-6">
      <SectionHeader
        eyebrow={eyebrow}
        title={title}
        headingId={headingId}
        titleSize="display"
        className="gap-3"
      />
      <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
        {body}
      </p>
      {bodySecondary ? (
        <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
          {bodySecondary}
        </p>
      ) : null}
      <Link
        href={ctaHref}
        className={cn(
          buttonVariants({ variant: "default", size: "default" }),
          "self-start",
        )}
      >
        {ctaLabel}
        {showCtaArrow ? (
          <MoveRight className="size-4" aria-hidden />
        ) : null}
      </Link>
    </div>
  );

  return (
    <section
      id={sectionId}
      className={cn(
        showRule ? homeSectionWithRuleClass : homeSectionClass,
        "grid grid-cols-1 items-center gap-10 sm:gap-12 lg:grid-cols-2 lg:gap-16 xl:gap-20",
        className,
      )}
      aria-labelledby={headingId}
    >
      {imagePosition === "start" ? (
        <>
          {image}
          {copy}
        </>
      ) : (
        <>
          {copy}
          {image}
        </>
      )}
    </section>
  );
}
