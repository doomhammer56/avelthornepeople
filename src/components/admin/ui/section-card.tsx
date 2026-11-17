import type { ComponentProps, ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<typeof Card>, "title" | "variant"> & {
  title?: ReactNode;
  description?: ReactNode;
  /** Trailing header content (buttons, menus, range switchers). */
  actions?: ReactNode;
  /** Padding for the body. Turn off for edge-to-edge tables. */
  padded?: boolean;
  headingId?: string;
  bodyClassName?: string;
};

/** The console's standard surface: bordered card with an optional header row. */
export function SectionCard({
  title,
  description,
  actions,
  padded = true,
  headingId,
  className,
  bodyClassName,
  children,
  ...props
}: Props) {
  const hasHeader = title || actions;
  return (
    <Card
      variant="panel"
      className={className}
      aria-labelledby={title ? headingId : undefined}
      {...props}
    >
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            {title ? (
              <h2 id={headingId} className="m-0 text-[15px] font-semibold">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={cn(padded && "p-5", "min-w-0", bodyClassName)}>
        {children}
      </div>
    </Card>
  );
}
