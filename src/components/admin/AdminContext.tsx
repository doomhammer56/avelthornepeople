"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { AdminLang } from "@/lib/admin/nav";
import type { StaffRole } from "@/lib/auth/permissions";

type AdminContextValue = { lang: AdminLang; role: StaffRole };
const AdminContext = createContext<AdminContextValue | null>(null);

// The layout already knows the signed-in role and the language cookie. Sharing
// them lets route fallbacks draw the real titles, labels and permitted buttons
// immediately instead of waiting for the page (which only they depend on).
export function AdminContextProvider({
  lang,
  role,
  children,
}: AdminContextValue & { children: ReactNode }) {
  return (
    <AdminContext.Provider value={{ lang, role }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdminContext() {
  const value = useContext(AdminContext);
  const requested = useSearchParams().get("lang");
  // An explicit ?lang= wins over the cookie, matching authLanguage() on the server.
  const lang: AdminLang =
    requested === "zh" || requested === "en"
      ? requested
      : (value?.lang ?? "en");
  return { lang, role: value?.role ?? null };
}
