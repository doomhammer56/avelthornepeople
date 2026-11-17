"use client";

import * as React from "react";
import { cn } from "cn";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-[120px] w-full rounded-md border border-foreground/20 bg-card px-3.5 py-3 text-sm text-foreground transition-all duration-150 outline-none placeholder:text-muted-foreground/60 focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 dark:bg-input/30 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
