"use client";
import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminRouter as useRouter } from "./AdminNavigation";

export function AdminRefreshButton({
  label,
  onRefresh,
  refreshing = false,
}: {
  label: string;
  onRefresh?: () => Promise<unknown>;
  refreshing?: boolean;
}) {
  const router = useRouter(),
    [pending, startTransition] = useTransition();
  const busy = pending || refreshing;
  return (
    <Button
      variant="outline"
      className="disabled:opacity-100"
      disabled={busy}
      aria-busy={busy}
      onClick={() =>
        startTransition(async () => {
          if (onRefresh) await onRefresh();
          else router.refresh();
        })
      }
    >
      <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden="true" />
      {label}
    </Button>
  );
}
