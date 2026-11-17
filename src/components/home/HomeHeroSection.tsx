import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { PublicIntentLink as Link } from "../PublicIntentLink";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { displayHeadingClass } from "@/lib/displayTypography";
import type { ContentImage } from "@/lib/content/contract";
import type { Locale } from "@/lib/homeContent";
import { siteContainerClass } from "@/lib/publicSite";

const HERO_HEADLINE_ACCENT = {
  en: "Expertise.",
  zh: "赋能专业",
} as const;

function renderHeroHeadlineLine(line: string, locale: Locale) {
  const accent = HERO_HEADLINE_ACCENT[locale];
  const accentIndex = line.indexOf(accent);
  if (accentIndex === -1) return line;

  return (
    <>
      {line.slice(0, accentIndex)}
      <span className="text-brand-teal">{accent}</span>
      {line.slice(accentIndex + accent.length)}
    </>
  );
}

type Props = {
  locale: Locale;
  heroLines: readonly string[];
  heroLead: string;
  heroLead2?: string;
  ctaJobs: string;
  ctaAbout: string;
  /** Published BANNER photograph; the approved workplace photo is the default. */
  image?: ContentImage | null;
  imageAlt?: string;
};

export function HomeHeroSection({
  locale,
  heroLines,
  heroLead,
  heroLead2,
  ctaJobs,
  ctaAbout,
  image,
  imageAlt,
}: Props) {
  const photo = {
    src: image?.url ?? "/photos/hero-workplace-1672w.webp",
    alt:
      (image && imageAlt) ||
      (locale === "zh"
        ? "三位同事围坐在笔记本电脑前专注讨论工作"
        : "Three colleagues discussing work around a laptop."),
  };
  return (
    <section
      className="home-hero relative overflow-hidden min-h-[480px] sm:min-h-[520px] lg:min-h-[620px] bg-muted-foreground/10 border-b border-[#061722]/10"
      aria-labelledby="hero-heading"
    >
      <div
        className="hidden lg:block absolute top-0 bottom-0 right-0 w-[50%] xl:w-[52%] h-full [clip-path:polygon(18%_0,100%_0,100%_100%,0_100%)] overflow-hidden bg-muted/20"
        aria-hidden="true"
      >
        <Image
          src={photo.src}
          alt={photo.alt}
          fill
          priority
          unoptimized
          className="object-cover object-[60%_center]"
        />
      </div>

      <div className={`${siteContainerClass} relative z-10 flex min-h-[inherit] items-center py-16 sm:py-20 lg:py-28`}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center w-full">
          <div className="lg:col-span-6 xl:col-span-6 flex flex-col justify-center">
            <h1 id="hero-heading" className={displayHeadingClass}>
              {heroLines.map((line) => (
                <span key={line} className="block">
                  {renderHeroHeadlineLine(line, locale)}
                </span>
              ))}
            </h1>

            <div className="mt-5 space-y-2 text-base sm:text-lg text-foreground/80 leading-relaxed max-w-lg">
              <p>{heroLead}</p>
              {heroLead2 ? <p>{heroLead2}</p> : null}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href={`/${locale}/careers`}
                className={cn(
                  buttonVariants({ variant: "default", size: "default" }),
                  "h-11 min-h-[44px] px-6 rounded-lg font-medium shadow-xs",
                )}
              >
                {ctaJobs}
              </Link>
              <Link
                href={`/${locale}/about`}
                className={cn(
                  buttonVariants({ variant: "outline", size: "default" }),
                  "inline-flex items-center gap-1.5 h-11 min-h-[44px] px-6 rounded-lg font-medium bg-background text-foreground hover:bg-background/80 shadow-2xs",
                )}
              >
                {ctaAbout}
                <ArrowUpRight className="size-4 shrink-0" aria-hidden />
              </Link>
            </div>
          </div>

          <div className="lg:hidden w-full mt-6">
            <div className="relative w-full h-[320px] sm:h-[400px] overflow-hidden rounded-xl bg-muted/20">
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                priority
                unoptimized
                className="object-cover object-[60%_center]"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
