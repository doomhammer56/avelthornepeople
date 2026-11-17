import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  label: string;
  disabled?: boolean;
  className?: string;
};

/** Compact either/or switch for a few mutually exclusive modes (e.g. email now / later). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  disabled,
  className,
}: Props<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
