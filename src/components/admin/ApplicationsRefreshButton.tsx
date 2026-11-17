"use client";

import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { invalidateAdminResource } from "@/lib/admin/cachePolicy";
import type { AdminLang } from "@/lib/admin/nav";
import { AdminRefreshButton } from "./AdminRefreshButton";

// Refetches the applications list and the sidebar's new-application count
// in place. It lives in the server-rendered page header, so it talks to the
// query cache directly instead of waiting on the board below it.
export function ApplicationsRefreshButton({ lang }: { lang: AdminLang }) {
  const client = useQueryClient();
  const fetching =
    useIsFetching({
      predicate: (query) =>
        query.queryKey[0] === "admin" &&
        ["applications", "application-count"].includes(
          String(query.queryKey[1]),
        ),
    }) > 0;
  return (
    <AdminRefreshButton
      label={lang === "en" ? "Refresh" : "\u5237\u65b0"}
      refreshing={fetching}
      onRefresh={() => invalidateAdminResource(client, "applications")}
    />
  );
}
