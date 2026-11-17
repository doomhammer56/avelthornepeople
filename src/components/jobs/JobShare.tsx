"use client";

import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { JobDetailContent } from "@/lib/jobDetailContent";

// Share only the public role URL, excluding carried search filters and other query data.
// Native sharing falls back to clipboard, then a selectable URL when browser permissions deny copying.
export function JobShare({
  title,
  content: t,
}: {
  title: string;
  content: JobDetailContent;
}) {
  const [state, setState] = useState<"idle" | "copied" | "fallback">("idle");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const share = async () => {
    const publicUrl = new URL(window.location.pathname, window.location.origin)
      .href;
    setBusy(true);
    setUrl(publicUrl);
    setState("idle");
    try {
      if (navigator.share) {
        await navigator.share({ title, url: publicUrl });
      } else {
        await navigator.clipboard.writeText(publicUrl);
        setState("copied");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setState("fallback");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex w-full flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-11 w-full px-6 py-3 text-sm"
        onClick={share}
        disabled={busy}
      >
        {t.share}
        <ArrowUpRight className="size-4 shrink-0" aria-hidden />
      </Button>
      <p role="status" className="empty:hidden">
        {state === "copied" ? t.copied : ""}
      </p>
      {state === "fallback" && (
        <label className="flex flex-col gap-2 text-sm">
          <span>{t.shareFailed}</span>
          <input
            className="min-h-11 w-full min-w-0 rounded-sm border border-input bg-background px-2 py-2 text-base text-foreground"
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </div>
  );
}
