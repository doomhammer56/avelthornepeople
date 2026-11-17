export type ExportReport = {
  locale: "en" | "zh";
  timeZone: string;
  summary: string[];
  pdf?: { headers: string[]; rows: string[][]; widths: number[] };
};

// Keep exported documents aligned with the console's Mist palette.
// Explicit values also make output independent of light or dark screen preferences.
export const reportColors = {
  accent: "4F6F94",
  ink: "33363D",
  secondary: "565A63",
  soft: "E9EEF4",
  paper: "F4F5F6",
  border: "DDE0E3",
  white: "FFFFFF",
} as const;

export const reportText = {
  en: {
    generated: "Generated",
    records: "Records on this page",
    internal: "Internal recruitment use",
    page: "Page",
    of: "of",
  },
  zh: {
    generated: "生成时间",
    records: "本页记录",
    internal: "招聘内部使用",
    page: "页码",
    of: "/",
  },
} as const;

// Estimate wrapped spreadsheet lines while accounting for wider CJK characters.
// Exported names and long addresses must remain visible instead of being clipped by fixed row heights.
export function exportLineCount(text: string, width: number) {
  return text
    .split(/\r?\n/)
    .reduce(
      (total, line) =>
        total +
        Math.max(
          1,
          Math.ceil(
            Array.from(line).reduce(
              (length, character) =>
                length + (character.codePointAt(0)! > 255 ? 2 : 1),
              0,
            ) / Math.max(1, width - 2),
          ),
        ),
      0,
    );
}
