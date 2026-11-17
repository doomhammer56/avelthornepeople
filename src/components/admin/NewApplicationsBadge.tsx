"use client";

import { useQuery } from "@tanstack/react-query";
import { adminRead } from "@/lib/admin/queries";
import { SidebarMenuBadge } from "@/components/ui/sidebar";

export function NewApplicationsBadge() {
  const { data } = useQuery({
    queryKey: ["admin", "application-count"],
    queryFn: ({ signal }) =>
      adminRead<{ count: number }>("/api/admin/applications/count", signal),
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  return data && data.count > 0 ? (
    <SidebarMenuBadge
      className="top-1/2! right-2.5 h-5 min-w-5 -translate-y-1/2 rounded-full bg-primary px-1.5 text-[11px] leading-none font-semibold text-primary-foreground peer-hover/menu-button:text-primary-foreground peer-data-active/menu-button:text-primary-foreground"
      aria-label={`${data.count}`}
    >
      {data.count > 99 ? "99+" : data.count}
    </SidebarMenuBadge>
  ) : null;
}
