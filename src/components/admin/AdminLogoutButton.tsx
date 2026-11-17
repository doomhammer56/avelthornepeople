"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import type { AdminLang } from "@/lib/admin/nav";
import { toast } from "sonner";
import { announceAdminLogout } from "@/lib/admin/cacheEvents";
import { Button } from "@/components/ui/button";

const text = { en: "Sign out", zh: "退出" };

// A compact sidebar-footer logout action. AuthForm already covers logout, but
// renders a full-width primary button meant for the auth card, not a footer link.
export function AdminLogoutButton({ lang }: { lang: AdminLang }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({ lang }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.next !== `/admin/login?lang=${lang}`)
        throw new Error("Sign-out failed");
      announceAdminLogout();
      window.location.replace(result.next);
    } catch {
      setBusy(false);
      toast.error(
        lang === "zh"
          ? "退出失败，请重试。"
          : "Could not sign out. Please try again.",
      );
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={signOut}
      disabled={busy}
      aria-label={text[lang]}
      title={text[lang]}
    >
      <LogOut aria-hidden="true" />
    </Button>
  );
}
