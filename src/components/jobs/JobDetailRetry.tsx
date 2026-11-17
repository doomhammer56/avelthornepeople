"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { siteButtonClass } from "@/lib/publicSite";

// Retry a failed detail fetch without navigating away from the current vacancy.
// The transition disables repeated requests while the server refresh is pending.
export function JobDetailRetry({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className={siteButtonClass({ outline: true, waiting: true })}
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
