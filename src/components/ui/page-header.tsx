import * as React from "react";
import { cn } from "cn";
import { displayHeadingClass } from "@/lib/displayTypography";
import { siteContainerClass } from "@/lib/publicSite";

type PageHeaderProps = {
  /** Decorated band (About/Services) or flat surface (e.g. job detail). */
  variant?: "default" | "plain";
  /** Renders above the title (e.g. back navigation). */
  aboveTitle?: React.ReactNode;
  eyebrow?: string;
  title: React.ReactNode;
  headingId: string;
  className?: string;
  children?: React.ReactNode;
};

/** Inner-page title band: eyebrow + display h1. Optional children for filters, etc. */
export function PageHeader({
  variant = "default",
  aboveTitle,
  eyebrow,
  title,
  headingId,
  className,
  children,
}: PageHeaderProps) {
  const body = (
    <>
      {aboveTitle}
      {eyebrow ? (
        <p className="page-header-eyebrow inline-flex items-center gap-2.5 m-0 text-xs font-semibold tracking-[0.14em] uppercase text-foreground/90">
          <span>{eyebrow}</span>
          <span
            className="inline-block w-8 sm:w-10 h-[1.5px] bg-brand-gold shrink-0"
            aria-hidden
          />
        </p>
      ) : null}

      <h1
        id={headingId}
        className={cn(
          variant === "plain"
            ? "m-0 max-w-[min(100%,22ch)] font-semibold text-[length:var(--site-page-heading-size)] leading-[1.12] tracking-[-0.035em] break-words [overflow-wrap:anywhere]"
            : cn(displayHeadingClass, "m-0 max-w-4xl"),
        )}
      >
        {title}
      </h1>

      {children}
    </>
  );

  if (variant === "plain") {
    return (
      <header
        className={cn(
          "rounded-none bg-site-header-light",
          className,
        )}
        aria-labelledby={headingId}
      >
        <div className={`${siteContainerClass} flex flex-col items-start gap-4 pt-7 pb-[clamp(1.75rem,4vw,2.5rem)]`}>
          {body}
        </div>
      </header>
    );
  }

  return (
    <section
      className={cn("page-header relative isolate bg-brand-teal/22", className)}
      aria-labelledby={headingId}
    >
      <div
        className={cn(
          "relative bg-site-header-light",
          // Left edge taller; teal-light shows through the cut on the right.
          "[clip-path:polygon(0_0,100%_0,100%_calc(100%-1rem),0_100%)]",
          "sm:[clip-path:polygon(0_0,100%_0,100%_calc(100%-1.75rem),0_100%)]",
        )}
      >
        <div className={`${siteContainerClass} flex flex-col items-start gap-3 pt-10 pb-14 sm:gap-4 sm:pt-12 sm:pb-16 lg:pt-16 lg:pb-20`}>
          {body}
        </div>
      </div>
    </section>
  );
}
