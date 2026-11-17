import type { ComponentProps } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Class list for a link/button that toggles a filter (status chips, ranges). */
export function filterPillClass(active: boolean, className?: string) {
  return cn(
    "inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
    active
      ? "border-primary/40 bg-accent text-foreground"
      : "border-border bg-card text-foreground/80 hover:bg-muted",
    className,
  );
}

/** Small tabular count shown inside a filter pill. */
export function PillCount({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {children}
    </span>
  );
}

/** Search box with a leading magnifier, used in list toolbars. */
export function SearchField({
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "type">) {
  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input type="search" className="pl-9" {...props} />
    </div>
  );
}
