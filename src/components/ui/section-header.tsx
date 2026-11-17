import * as React from "react";
import { cn } from "cn";
import { displayHeadingClass } from "@/lib/displayTypography";

interface SectionHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  align?: "left" | "center";
  weight?: "normal" | "medium" | "semibold" | "bold";
  headingId?: string;
  /** Same scale as homepage hero when set to `display`. */
  titleSize?: "default" | "display";
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
  align = "left",
  weight = "semibold",
  headingId,
  titleSize = "default",
  className,
  ...props
}: SectionHeaderProps) {
  const isCenter = align === "center";

  const weightClass = {
    normal: "font-normal",
    medium: "font-medium",
    semibold: "font-semibold",
    bold: "font-bold",
  }[weight];

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5",
        action && "md:flex-row md:items-end md:justify-between md:gap-8",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          titleSize === "display" ? "max-w-3xl" : "max-w-2xl",
          isCenter && "mx-auto text-center",
        )}
      >
        {eyebrow && (
          <div
            className={cn(
              "inline-flex items-center gap-2.5 text-xs font-semibold tracking-[0.14em] uppercase text-foreground/90 mb-1",
              isCenter && "justify-center",
            )}
          >
            <span>{eyebrow}</span>
            <span
              className="inline-block w-8 sm:w-10 h-[1.5px] bg-brand-gold"
              aria-hidden="true"
            />
          </div>
        )}
        <h2
          id={headingId}
          className={cn(
            titleSize === "display"
              ? displayHeadingClass
              : "font-serif text-xl sm:text-2xl md:text-3xl tracking-[-0.015em] text-foreground leading-[1.25] text-balance",
            titleSize === "default" && weightClass,
          )}
        >
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-sm sm:text-base text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0 pt-2 md:pt-0">{action}</div>}
    </div>
  );
}
