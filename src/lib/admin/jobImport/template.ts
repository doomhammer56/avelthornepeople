// Builds the downloadable .xlsx template. Runs in the browser (like the report
// exports) and in tests. ExcelJS is loaded lazily so it stays out of page bundles.
import {
  genderOptions,
  headerLabel,
  importColumns,
  importLimits,
  importTemplate,
  priorityOptions,
  type ImportColumnKey,
} from "./columns.ts";
import type { ImportRefs } from "./validate.ts";

export const templateSheets = {
  jobs: "Jobs",
  guide: "Guide",
  reference: "Reference",
  meta: "_meta",
} as const;

export async function buildJobImportTemplate(
  refs: ImportRefs,
): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Avelthorne People Group";
  workbook.created = new Date();

  const jobs = workbook.addWorksheet(templateSheets.jobs, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const guide = workbook.addWorksheet(templateSheets.guide);
  const reference = workbook.addWorksheet(templateSheets.reference);
  const meta = workbook.addWorksheet(templateSheets.meta, { state: "hidden" });

  // Reference lists. Each list occupies its own column so a dropdown can point at it.
  const lists: {
    key: ImportColumnKey;
    title: string;
    items: ImportRefs[keyof ImportRefs];
  }[] = [
    { key: "project", title: "Project", items: refs.departments },
    { key: "location", title: "Location", items: refs.locations },
    { key: "job_type", title: "Job type", items: refs.jobTypes },
    { key: "experience", title: "Experience", items: refs.experienceLevels },
  ];
  const listColumn = new Map<
    ImportColumnKey,
    { column: number; count: number }
  >();
  lists.forEach((list, index) => {
    const first = index * 4 + 1;
    reference.getCell(1, first).value = `${list.title} (中文)`;
    reference.getCell(1, first + 1).value = "Code";
    reference.getCell(1, first + 2).value = "English";
    const active = list.items.filter((item) => item.active);
    active.forEach((item, row) => {
      reference.getCell(row + 2, first).value = item.label.zh;
      reference.getCell(row + 2, first + 1).value = item.code;
      reference.getCell(row + 2, first + 2).value = item.label.en;
    });
    listColumn.set(list.key, {
      column: first,
      count: Math.max(1, active.length),
    });
    reference.getRow(1).font = { bold: true };
    reference.getColumn(first).width = 24;
    reference.getColumn(first + 1).width = 18;
    reference.getColumn(first + 2).width = 24;
  });
  const range = (key: ImportColumnKey) => {
    const info = listColumn.get(key)!;
    const letter = reference.getColumn(info.column).letter;
    return `${templateSheets.reference}!$${letter}$2:$${letter}$${info.count + 1}`;
  };

  jobs.columns = importColumns.map((column) => ({
    header: headerLabel(column),
    key: column.key,
    width: column.width,
  }));
  const header = jobs.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  header.eachCell((cell, index) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: importColumns[index - 1].required ? "FFFDE9D9" : "FFE8EEF7",
      },
    };
  });

  const dropdowns: Partial<Record<ImportColumnKey, string>> = {
    project: range("project"),
    job_type: range("job_type"),
    experience: range("experience"),
    salary_period: '"时,日,月,年"',
    show_salary: '"是,否"',
    priority: `"${priorityOptions.map((o) => o.zh).join(",")}"`,
    gender: `"${genderOptions.map((o) => o.zh).join(",")}"`,
  };
  importColumns.forEach((column, index) => {
    const sheetColumn = jobs.getColumn(index + 1);
    const numeric = column.key === "salary_min" || column.key === "salary_max";
    // Text format stops Excel from turning codes and numbered lists into numbers or dates.
    if (!numeric) sheetColumn.numFmt = "@";
    sheetColumn.alignment = { vertical: "top", wrapText: true };
    const formula = dropdowns[column.key];
    for (let row = 2; row <= importLimits.maxRows + 1; row++) {
      const target = jobs.getCell(row, index + 1);
      if (formula)
        target.dataValidation = {
          type: "list",
          allowBlank: true,
          showErrorMessage: true,
          formulae: [formula],
        };
      else if (numeric)
        target.dataValidation = {
          type: "decimal",
          operator: "greaterThanOrEqual",
          allowBlank: true,
          showErrorMessage: true,
          formulae: [0],
        };
    }
  });

  guide.columns = [
    { header: "Column / 列", key: "column", width: 34 },
    { header: "Required / 必填", key: "required", width: 16 },
    { header: "Notes / 说明", key: "note", width: 70 },
  ];
  guide.getRow(1).font = { bold: true };
  for (const column of importColumns)
    guide.addRow({
      column: headerLabel(column).replace(" *", ""),
      required: column.required ? "Yes / 是" : "No / 否",
      note: `${column.note.zh} · ${column.note.en}`,
    });
  guide.addRow({});
  guide.addRow({
    column: "Limits / 限制",
    note: `Up to ${importLimits.maxRows} rows per file. Row 1 of the Jobs sheet is the header; do not rename or reorder the sheets. Imported jobs are saved as drafts.`,
  });

  meta.getCell("A1").value = importTemplate.id;
  meta.getCell("B1").value = importTemplate.version;
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
