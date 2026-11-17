import type { CSSProperties } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Placeholders for values that are only known once data arrives. Titles,
 * labels, column headers and buttons are static and are always rendered for
 * real; only the numbers, rows and charts they sit around use these.
 */
export function Bone({
  width = "100%",
  height = 14,
  className,
}: {
  width?: number | string;
  height?: number;
  className?: string;
}) {
  const style: CSSProperties = { width, height };
  return (
    <Skeleton
      aria-hidden="true"
      className={cn("inline-block max-w-full align-middle", className)}
      style={style}
    />
  );
}

const widths = ["68%", "52%", "74%", "46%", "60%", "70%"];

/** Body rows for a real <Table>: the header above them stays untouched. */
export function TableRowsSkeleton({
  columns,
  rows = 6,
  leading = false,
  trailingRight = false,
}: {
  columns: number;
  rows?: number;
  /** First cell is a checkbox column. */
  leading?: boolean;
  /** Last cell is right-aligned (row actions). */
  trailingRight?: boolean;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <TableRow key={row} aria-hidden="true" className="hover:bg-transparent">
          {Array.from({ length: columns }, (_, column) => (
            <TableCell
              key={column}
              className={
                trailingRight && column === columns - 1 ? "text-right" : ""
              }
            >
              {leading && column === 0 ? (
                <Bone width={16} height={16} className="rounded-sm" />
              ) : (
                <Bone
                  width={
                    trailingRight && column === columns - 1
                      ? 56
                      : widths[(row + column) % widths.length]
                  }
                  height={13}
                />
              )}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
