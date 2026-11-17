// Minimal CSV helpers shared by import (parseCsv) and export (toCsv).
// The design-only importer is deliberately simple (no quoted-comma support).
// Export escapes CSV delimiters and keeps user-provided spreadsheet formulas inert.
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

function escapeCell(value: string): string {
  const text =
    /^\s*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(",").map((cell) => cell.trim()));
}
