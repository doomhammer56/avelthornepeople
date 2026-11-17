"use client";

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "cn";

interface SeparatorProps extends SeparatorPrimitive.Props {
  variant?: "default" | "gold" | "muted";
}

function Separator({
  className,
  orientation = "horizontal",
  variant = "default",
  ...props
}: SeparatorProps) {
  const variantStyles = {
    default: "bg-border",
    gold: "bg-brand-gold",
    muted: "bg-border/40",
  }[variant];

  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        variantStyles,
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
