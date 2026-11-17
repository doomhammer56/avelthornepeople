import * as React from "react";
import { cn } from "cn";

interface CardProps extends React.ComponentProps<"div"> {
  variant?: "default" | "outline" | "ivory" | "navy" | "panel";
}

function Card({ className, variant = "default", ...props }: CardProps) {
  const variantStyles = {
    default: "bg-card text-card-foreground border border-border/80 shadow-xs hover:border-brand-teal/30",
    outline: "bg-transparent text-foreground border border-border/80",
    ivory: "bg-secondary text-secondary-foreground border border-border/60",
    navy: "bg-brand-navy text-white border border-brand-navy-light shadow-md",
    // Staff-console surface: flat, no hover accent, no built-in padding.
    panel: "bg-card text-card-foreground border border-border rounded-lg p-0 transition-none",
  }[variant];

  return (
    <div
      data-slot="card"
      className={cn(
        "flex flex-col overflow-hidden rounded-xl p-6 transition-all duration-200",
        variantStyles,
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-2 mb-3", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn(
        "font-serif text-lg sm:text-xl font-semibold tracking-tight text-foreground leading-snug",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn(
        "text-sm text-muted-foreground leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("flex-1", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center pt-5 mt-auto border-t border-border/50", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
