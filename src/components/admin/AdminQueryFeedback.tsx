"use client";

import { useState, type ReactNode } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import type { AdminLang } from "@/lib/admin/nav";
import { isAccessError } from "@/lib/admin/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Keep the snapshot and its query metadata together when a changed filter fails.
export function useAdminQuerySnapshot<T extends object>(
  data: T | undefined,
  placeholder = false,
  error?: unknown,
) {
  const [last, setLast] = useState<T>();
  if (isAccessError(error)) {
    if (last) setLast(undefined);
    return undefined;
  }
  if (data && !placeholder && data !== last) setLast(data);
  return data ?? last;
}

/** Small "refreshing…" line shown while a list re-queries in the background. */
export function UpdatingStatus({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="m-0 flex items-center gap-2 text-xs text-muted-foreground"
    >
      <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
      {children}
    </p>
  );
}

export function AdminQueryFeedback({
  lang,
  error,
  hasData = true,
  retry,
}: {
  lang: AdminLang;
  error: boolean;
  hasData?: boolean;
  retry: () => void;
}) {
  if (error)
    return (
      <Alert variant="destructive" role="alert">
        <CircleAlert aria-hidden="true" />
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>
            {lang === "zh"
              ? hasData
                ? "无法更新，当前显示上次加载的结果。"
                : "暂时无法加载此信息。"
              : hasData
                ? "Could not refresh. Showing the last loaded results."
                : "This information is temporarily unavailable."}
          </span>
          <Button variant="outline" size="sm" onClick={retry}>
            {lang === "zh" ? "重试" : "Retry"}
          </Button>
        </AlertDescription>
      </Alert>
    );
  // Background refreshes show no banner: the page keeps its data and layout,
  // and screens with a Refresh button already show it spinning.
  return null;
}
