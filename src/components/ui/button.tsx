import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/btn inline-flex shrink-0 items-center justify-center rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150 outline-none select-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-brand-teal text-white shadow-xs hover:bg-brand-teal-hover focus-visible:ring-brand-teal/40 active:translate-y-px",
        navy:
          "bg-brand-navy text-white shadow-xs hover:bg-brand-navy-light focus-visible:ring-brand-navy/40 active:translate-y-px",
        outline:
          "border border-foreground/25 bg-transparent text-foreground hover:bg-foreground/5 hover:border-foreground/50 focus-visible:ring-brand-teal/40 active:translate-y-px",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border/50 focus-visible:ring-brand-teal/40 active:translate-y-px",
        ghost:
          "text-foreground hover:bg-foreground/5 focus-visible:ring-brand-teal/40",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40",
        "destructive-outline":
          "border border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10 focus-visible:ring-destructive/40",
        link:
          "text-brand-teal p-0 h-auto font-medium hover:text-brand-teal-hover hover:underline underline-offset-4 gap-1.5 focus-visible:ring-0",
      },
      size: {
        sm: "h-8 px-3.5 text-xs rounded-md gap-1.5",
        default:
          "h-(--button-h,2.75rem) min-h-(--button-h,2.75rem) px-5 py-2.5 text-sm rounded-lg gap-2",
        lg: "h-12 min-h-[48px] px-6 py-3 text-base rounded-lg gap-2.5 font-semibold",
        xl: "h-[52px] min-h-[52px] px-8 py-3.5 text-base rounded-xl gap-3 font-semibold",
        icon: "size-10 rounded-lg",
        "icon-sm": "size-8 rounded-md",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
