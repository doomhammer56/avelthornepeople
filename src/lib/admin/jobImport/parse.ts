// Turns an uploaded .xlsx into raw text cells. It decides nothing about validity
// beyond the file shape (template, headers, size): the server validates the rows.
import type { CellValue } from "exceljs";
import {
  columnForHeader,
  importColumns,
  importLimits,
  importTemplate,
  type ImportColumnKey,
} from "./columns.ts";
import { templateSheets } from "./template.ts";
import type { ImportRowInput } from "./validate.ts";

export type SheetIssueCode =
  | "file_too_large"
  | "not_xlsx"
  | "template_mismatch"
  | "missing_sheet"
  | "missing_columns"
  | "duplicate_columns"
  | "too_many_rows"
  | "empty";
export type SheetIssue = { code: SheetIssueCode; columns?: ImportColumnKey[] };
export type ParsedImport = {
  issues: SheetIssue[];
  /** Header texts that match no template column. They are ignored. */
  unknownColumns: string[];
  /** True when the workbook has no template marker but its headers still match. */
  missingMarker: boolean;
  rows: ImportRowInput[];
};

export function cellText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ("richText" in value)
    return value.richText.map((part) => part.text).join("");
  if ("result" in value) return cellText(value.result as CellValue);
  if ("text" in value) return cellText(value.text as CellValue);
  return "";
}

const failed = (code: SheetIssueCode): ParsedImport => ({
  issues: [{ code }],
  unknownColumns: [],
  missingMarker: false,
  rows: [],
});

export async function parseJobImportWorkbook(
  data: ArrayBuffer | Uint8Array,
): Promise<ParsedImport> {
  if (data.byteLength > importLimits.maxFileBytes)
    return failed("file_too_large");
  // An .xlsx is a zip archive: reject anything else before handing it to the parser.
  const head = new Uint8Array(data.slice(0, 2));
  if (head[0] !== 0x50 || head[1] !== 0x4b) return failed("not_xlsx");
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as ArrayBuffer);
  } catch {
    return failed("not_xlsx");
  }

  const metaSheet = workbook.getWorksheet(templateSheets.meta);
  let missingMarker = false;
  if (metaSheet) {
    const id = cellText(metaSheet.getCell("A1").value);
    const version = Number(cellText(metaSheet.getCell("B1").value));
    if (id !== importTemplate.id || version !== importTemplate.version)
      return failed("template_mismatch");
  } else missingMarker = true;

  const sheet =
    workbook.getWorksheet(templateSheets.jobs) ??
    workbook.worksheets.find(
      (candidate) =>
        candidate.state === "visible" &&
        candidate.name !== templateSheets.guide &&
        candidate.name !== templateSheets.reference,
    );
  if (!sheet) return failed("missing_sheet");

  const byColumn = new Map<number, ImportColumnKey>();
  const seen = new Set<ImportColumnKey>();
  const duplicates = new Set<ImportColumnKey>();
  const unknownColumns: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, index) => {
    const text = cellText(cell.value).trim();
    if (!text) return;
    const key = columnForHeader(text);
    if (!key) unknownColumns.push(text.slice(0, 80));
    else if (seen.has(key)) duplicates.add(key);
    else {
      seen.add(key);
      byColumn.set(index, key);
    }
  });
  const issues: SheetIssue[] = [];
  const missing = importColumns
    .filter((column) => column.required && !seen.has(column.key))
    .map((column) => column.key);
  if (missing.length)
    issues.push({ code: "missing_columns", columns: missing });
  if (duplicates.size)
    issues.push({ code: "duplicate_columns", columns: [...duplicates] });

  const rows: ImportRowInput[] = [];
  let overflow = false;
  if (!issues.length)
    sheet.eachRow({ includeEmpty: false }, (row, number) => {
      if (number === 1 || overflow) return;
      const cells: Partial<Record<ImportColumnKey, string>> = {};
      let any = false;
      for (const [index, key] of byColumn) {
        const text = cellText(row.getCell(index).value);
        if (text.trim()) any = true;
        cells[key] = text;
      }
      if (!any) return;
      if (rows.length >= importLimits.maxRows) overflow = true;
      else rows.push({ row: number, cells });
    });
  if (overflow) issues.push({ code: "too_many_rows" });
  else if (!issues.length && !rows.length) issues.push({ code: "empty" });
  return { issues, unknownColumns, missingMarker, rows };
}
