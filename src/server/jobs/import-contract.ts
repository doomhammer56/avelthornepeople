import { z } from "zod";
import {
  importColumnKeys,
  importLimits,
} from "../../lib/admin/jobImport/columns.ts";
import type { ImportDecisions } from "../../lib/admin/jobImport/validate.ts";

// Request bodies carry the parsed cells as text. The server never trusts a
// client-side "valid" flag: every request is validated again from these cells.
const rowNumber = z.number().int().min(1).max(1_048_576);
const rowKey = z.string().regex(/^[1-9][0-9]{0,6}$/);
const choice = z.enum(["skip", "overwrite"]);

const rows = z
  .array(
    z.strictObject({
      row: rowNumber,
      cells: z.partialRecord(
        z.enum(importColumnKeys),
        z.string().max(importLimits.maxCellChars),
      ),
    }),
  )
  .min(1)
  .max(importLimits.maxRows)
  .refine((list) => new Set(list.map((r) => r.row)).size === list.length);

const decisions = z
  .strictObject({
    default: choice.nullable(),
    perRow: z
      .record(rowKey, choice)
      .refine((v) => Object.keys(v).length <= importLimits.maxRows),
  })
  .transform((v): ImportDecisions => ({
    default: v.default,
    perRow: Object.fromEntries(
      Object.entries(v.perRow).map(([key, value]) => [Number(key), value]),
    ),
  }));

export const importPreviewSchema = z.strictObject({ rows, decisions });

export const importCommitSchema = z.strictObject({
  requestId: z.uuid(),
  fileName: z.string().max(1000),
  rows,
  decisions,
  // The job version each overwrite was previewed against. If the job changed
  // since, the whole batch is refused instead of clobbering the newer edit.
  overwrites: z.record(
    rowKey,
    z.strictObject({
      id: z.uuid(),
      version: z.number().int().positive().max(2147483646),
    }),
  ),
});
export type ImportCommit = z.infer<typeof importCommitSchema>;

/** Keeps only the base name, drops control characters and bounds the length. */
export function safeImportFileName(value: string): string {
  const base = value.split(/[/\x5c]/).pop() ?? "";
  const clean = base
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(-importLimits.maxFileNameChars) : "import.xlsx";
}

export type ImportHistoryEntry = {
  id: string;
  fileName: string;
  status: "COMPLETED" | "FAILED";
  actorName: string | null;
  totalRows: number;
  created: number;
  overwritten: number;
  skipped: number;
  failed: number;
  createdAt: string;
};
export type ImportCommitResult = {
  importId: string;
  created: number;
  overwritten: number;
  skipped: number;
};
