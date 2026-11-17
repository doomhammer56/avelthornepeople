"use client";

import type { AdminLang } from "@/lib/admin/nav";
import { useAdminRouter } from "./AdminNavigation";
import { AdminPagination } from "./AdminPagination";

// For lists rendered on the server that only report whether another page exists.
// Navigation rebuilds the URL from the active filters, so they survive paging.
export function RoutePagination({
  lang,
  path,
  page,
  pageSize,
  rowCount,
  hasMore,
  params,
  pageSizeParam = true,
}: {
  lang: AdminLang;
  /** Route to navigate within, e.g. `/admin/log`. */
  path: string;
  page: number;
  pageSize: number;
  rowCount: number;
  hasMore: boolean;
  /** Active filters as a query string, without `page` or `pageSize`. */
  params: string;
  /** Hide the rows-per-page selector for routes with a fixed page size. */
  pageSizeParam?: boolean;
}) {
  const router = useAdminRouter();
  const go = (nextPage: number, nextSize = pageSize) => {
    const query = new URLSearchParams(params);
    query.set("page", String(nextPage));
    if (pageSizeParam) query.set("pageSize", String(nextSize));
    router.push(`${path}?${query}`);
  };
  return (
    <AdminPagination
      lang={lang}
      page={page}
      pageSize={pageSize}
      rowCount={rowCount}
      hasMore={hasMore && page < 10000}
      onPageChange={(next) => go(next)}
      onPageSizeChange={pageSizeParam ? (size) => go(1, size) : undefined}
    />
  );
}
