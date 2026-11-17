"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { detailSource } from "@/server/analytics/source";

export function JobDetailView({
  jobId,
  locale,
}: {
  jobId: string;
  locale: "en" | "zh";
}) {
  const pathname = usePathname();
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const navigation = `${pathname}:${jobId}`;
    const send = () => {
      if (document.visibilityState !== "visible" || sent.current === navigation)
        return;
      sent.current = navigation;
      void fetch("/api/analytics/job-detail-view", {
        method: "POST",
        credentials: "omit",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          locale,
          source: detailSource(
            new URLSearchParams(window.location.search).get("utm_source"),
            document.referrer,
            window.location.origin,
          ),
        }),
      }).catch(() => {});
    };
    send();
    document.addEventListener("visibilitychange", send);
    return () => document.removeEventListener("visibilitychange", send);
  }, [pathname, jobId, locale]);
  return null;
}
