"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

// Re-fetch live public summaries while the visitor keeps a page open.
// A 30-second interval leaves room for the request within the one-minute update target.
export function PublicJobsRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!enabled || pending) return;
    const refresh = () => {
      if (document.visibilityState === "visible")
        startTransition(() => router.refresh());
    };
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [enabled, pending, router]);
  return null;
}
