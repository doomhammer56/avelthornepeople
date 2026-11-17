import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons / menus shown on the trailing edge (wraps below on narrow screens). */
  actions?: ReactNode;
  /** Back link or breadcrumb rendered above the title. */
  above?: ReactNode;
  className?: string;
};

/** Page title row used at the top of every console screen. */
export function AdminPageHeader({
  title,
  description,
  actions,
  above,
  className,
}: Props) {
  return (
    <header className={cn("flex flex-col gap-2", className)}>
      {above}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-2xl leading-tight font-bold">{title}</h1>
          {description ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
