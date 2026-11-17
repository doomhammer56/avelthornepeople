import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded-sm px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "bg-brand-teal text-white",
        navy: "bg-brand-navy text-white",
        secondary: "bg-secondary text-secondary-foreground border border-border/40",
        gold: "bg-brand-gold/15 text-brand-gold border border-brand-gold/30",
        outline: "text-foreground border border-foreground/30",
      },
      // Status tones for the staff console. Every tone is a soft tinted
      // background with a matching foreground, so a status looks the same
      // on every screen (see --tone-* in globals.css / admin.css).
      tone: {
        gray: "rounded-md bg-tone-gray px-2 py-1 font-medium tracking-normal text-tone-gray-foreground",
        amber: "rounded-md bg-tone-amber px-2 py-1 font-medium tracking-normal text-tone-amber-foreground",
        violet: "rounded-md bg-tone-violet px-2 py-1 font-medium tracking-normal text-tone-violet-foreground",
        rose: "rounded-md bg-tone-rose px-2 py-1 font-medium tracking-normal text-tone-rose-foreground",
        green: "rounded-md bg-tone-green px-2 py-1 font-medium tracking-normal text-tone-green-foreground",
        accent: "rounded-md bg-tone-accent px-2 py-1 font-medium tracking-normal text-tone-accent-foreground",
        "accent-solid": "rounded-md bg-primary px-2 py-1 font-medium tracking-normal text-primary-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, tone, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant: tone ? null : variant, tone }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
