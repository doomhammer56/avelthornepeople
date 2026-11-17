import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  icon?: LucideIcon;
  /** Highlights the value for things that need attention (expired jobs, etc). */
  warning?: boolean;
  className?: string;
};

/** A single headline metric. Render several inside <KpiGrid>. */
export function KpiCard({
  label,
  value,
  note,
  icon: Icon,
  warning,
  className,
}: Props) {
  return (
    <Card
      variant="panel"
      className={cn("flex flex-col gap-2.5 px-5 py-4", className)}
    >
      <div className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
        <span>{label}</span>
        {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
      </div>
      <div
        className={cn(
          "text-3xl leading-none font-bold tabular-nums",
          warning && "text-destructive",
        )}
      >
        {value}
      </div>
      {note ? (
        <div className="text-xs leading-snug text-muted-foreground">
          {note}
        </div>
      ) : null}
    </Card>
  );
}

export function KpiGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
