"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Ellipsis,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { AdminLang } from "@/lib/admin/nav";
import { tableContent } from "@/lib/admin/tableContent";

type Props = {
  lang: AdminLang;
  page: number;
  pageSize: number;
  /** Row count on this page; used for the "Showing x–y" text. */
  rowCount: number;
  /** Known total. Omit when the backend only reports whether more pages exist. */
  total?: number;
  /** Used when `total` is unknown. */
  hasMore?: boolean;
  pageSizes?: readonly number[];
  busy?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
};

// Up to seven slots: first, last, the current page and its neighbours, with
// gaps collapsed into ellipses. Short ranges show every page.
export function pageWindow(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const wanted = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => wanted.add(n));
  if (page >= pages - 2)
    [pages - 3, pages - 2, pages - 1].forEach((n) => wanted.add(n));
  const sorted = [...wanted]
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  sorted.forEach((n, index) => {
    if (index && n - sorted[index - 1] > 1) result.push("gap");
    result.push(n);
  });
  return result;
}

export function AdminPagination({
  lang,
  page,
  pageSize,
  rowCount,
  total,
  hasMore = false,
  pageSizes = [10, 20, 50, 100],
  busy = false,
  onPageChange,
  onPageSizeChange,
}: Props) {
  const t = tableContent[lang];
  const known = total !== undefined;
  const pages = known ? Math.max(1, Math.ceil(total / pageSize)) : undefined;
  const hasNext = known ? page < pages! : hasMore;
  const from = rowCount ? (page - 1) * pageSize + 1 : 0;
  const to = rowCount ? from + rowCount - 1 : 0;
  const sizes = pageSizes.includes(pageSize)
    ? pageSizes
    : [...pageSizes, pageSize].sort((a, b) => a - b);
  const summary = !rowCount
    ? t.none
    : known
      ? t.showing(from, to, total)
      : t.showingUnknown(from, to);

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3"
      aria-label={t.pagination}
    >
      <p className="m-0 text-xs text-muted-foreground" role="status">
        {summary}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        {onPageSizeChange ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t.rowsPerPage}</span>
            <NativeSelect
              size="sm"
              value={pageSize}
              disabled={busy}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {sizes.map((size) => (
                <NativeSelectOption key={size} value={size}>
                  {size}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        <div className="flex items-center gap-1">
          {known ? (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t.first}
              disabled={busy || page <= 1}
              onClick={() => onPageChange(1)}
            >
              <ChevronsLeft aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t.previous}
            disabled={busy || page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          {known ? (
            pageWindow(page, pages!).map((entry, index) =>
              entry === "gap" ? (
                <span
                  key={`gap-${index}`}
                  className="flex size-8 items-center justify-center text-muted-foreground"
                  aria-hidden="true"
                >
                  <Ellipsis className="size-4" />
                </span>
              ) : (
                <Button
                  key={entry}
                  variant={entry === page ? "default" : "outline"}
                  size="icon-sm"
                  className="tabular-nums"
                  aria-label={t.page(entry)}
                  aria-current={entry === page ? "page" : undefined}
                  disabled={busy}
                  onClick={() => entry !== page && onPageChange(entry)}
                >
                  {entry}
                </Button>
              ),
            )
          ) : (
            <span
              className="px-2 text-xs font-medium tabular-nums"
              aria-current="page"
            >
              {t.page(page)}
            </span>
          )}
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t.next}
            disabled={busy || !hasNext}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          {known ? (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t.last}
              disabled={busy || page >= pages!}
              onClick={() => onPageChange(pages!)}
            >
              <ChevronsRight aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
