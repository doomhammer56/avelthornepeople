"use client";

import { toCsv } from "./csv";
import {
  exportLineCount,
  reportColors as colors,
  reportText,
  type ExportReport,
} from "./exportReport";

// Release temporary download URLs after the browser has accepted the file.
// Candidate records remain in memory and are never uploaded or written to browser storage.
export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Keep CSV compatible with Excel's UTF-8 detection and the existing formula escaping.
// Downloads contain only the explicitly supplied rows from the current application page.
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: string[][],
) {
  triggerDownload(
    new Blob(["\ufeff", toCsv([headers, ...rows])], {
      type: "text/csv;charset=utf-8;",
    }),
    filename,
  );
}

// Build a workbook with the same branded header, scope and timestamps as the PDF.
// Explicit string cells preserve UUIDs, phone numbers and formula-like candidate names safely.
export async function createXlsx(
  title: string,
  sheetName: string,
  headers: string[],
  rows: string[][],
  report?: ExportReport,
) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Avelthorne People Group";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(
    sheetName.replace(/[\\/*?:\[\]]/g, " ").slice(0, 31) || "Report",
    {
      properties: { tabColor: { argb: "FF" + colors.accent } },
      views: [{ state: "frozen", ySplit: 6 }],
      pageSetup: {
        orientation: "landscape",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: "1:6",
      },
    },
  );
  const locale = report?.locale ?? "en",
    timeZone = report?.timeZone ?? "UTC";
  const t = reportText[locale];
  const generated = new Intl.DateTimeFormat(
    locale === "zh" ? "zh-CN" : "en-GB",
    { dateStyle: "medium", timeStyle: "short", timeZone },
  ).format(workbook.created);
  const widths = headers.map((_, index) =>
    Math.min(
      42,
      Math.max(
        16,
        ...[headers, ...rows].map((row) =>
          Math.min(42, Array.from(row[index] ?? "").length + 3),
        ),
      ),
    ),
  );
  sheet.columns = widths.map((width) => ({ width }));
  const summary = [
    ...(report?.summary ?? []),
    `${t.records}: ${rows.length}`,
  ].join(" | ");
  const heading = [
    "AVELTHORNE PEOPLE GROUP",
    title,
    `${t.generated}: ${generated} (${timeZone})`,
    summary,
  ];
  heading.forEach((value, index) => {
    const number = index + 1;
    sheet.mergeCells(number, 1, number, headers.length);
    const cell = sheet.getCell(number, 1);
    cell.value = value;
    cell.font = {
      name: "Aptos",
      size: index === 0 ? 13 : index === 1 ? 17 : 10,
      bold: index < 2,
      color: {
        argb:
          "FF" +
          (index === 0
            ? colors.white
            : index < 2
              ? colors.ink
              : colors.secondary),
      },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF" + (index === 0 ? colors.accent : colors.white) },
    };
    cell.alignment = { vertical: "middle", wrapText: true, indent: 1 };
    sheet.getRow(number).height =
      index === 0
        ? 30
        : index === 1
          ? 34
          : Math.max(
              24,
              exportLineCount(
                value,
                widths.reduce((a, b) => a + b, 0),
              ) *
                15 +
                8,
            );
  });
  sheet.getRow(5).height = 10;
  const header = sheet.getRow(6);
  header.values = headers;
  header.height = 28;
  header.eachCell((cell) => {
    cell.font = {
      name: "Aptos",
      size: 10,
      bold: true,
      color: { argb: "FF" + colors.white },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF" + colors.accent },
    };
    cell.alignment = { vertical: "middle", wrapText: true, indent: 1 };
  });
  rows.forEach((values, index) => {
    const row = sheet.addRow(values.map(String));
    row.height = Math.max(
      28,
      ...values.map(
        (value, column) => exportLineCount(value, widths[column]) * 15 + 10,
      ),
    );
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.numFmt = "@";
      cell.font = {
        name: "Aptos",
        size: 10,
        color: { argb: "FF" + colors.ink },
      };
      cell.alignment = { vertical: "top", wrapText: true, indent: 1 };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF" + (index % 2 ? colors.paper : colors.white) },
      };
      cell.border = {
        bottom: { style: "hair", color: { argb: "FF" + colors.border } },
      };
    });
  });
  sheet.autoFilter = {
    from: { row: 6, column: 1 },
    to: { row: Math.max(6, sheet.rowCount), column: headers.length },
  };
  sheet.headerFooter.oddFooter = `&LAvelthorne People Group - ${t.internal}&R${t.page} &P ${t.of} &N`;
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// Generate the workbook only after an authorized staff member requests an export.
// Spreadsheet dependencies stay out of the initial page-loading path.
export async function downloadXlsx(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: string[][],
  report?: ExportReport,
) {
  triggerDownload(
    await createXlsx(sheetName, sheetName, headers, rows, report),
    filename,
  );
}

let fontData: Promise<string> | null = null;

// Load the licensed bilingual font only when a PDF is actually requested.
// A failed download clears the cache so the user can retry without reloading the page.
function pdfFont() {
  fontData ??= fetch("/fonts/AvelthorneExport-Regular.ttf", {
    cache: "force-cache",
    signal: AbortSignal.timeout(60000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Export font unavailable");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const parts: string[] = [];
      for (let index = 0; index < bytes.length; index += 32768)
        parts.push(
          String.fromCharCode(...bytes.subarray(index, index + 32768)),
        );
      return btoa(parts.join(""));
    })
    .catch(() => {
      fontData = null;
      throw new Error("Export font unavailable");
    });
  return fontData;
}

// Build a text-searchable bilingual report using the admin palette and repeated headers.
// Wrapped cells and protected row breaks keep candidate details readable across pages.
export async function createPdf(
  title: string,
  headers: string[],
  rows: string[][],
  report?: ExportReport,
) {
  const [{ default: jsPDF }, { default: autoTable }, font] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    pdfFont(),
  ]);
  const doc = new jsPDF({
    orientation: "landscape",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });
  doc.addFileToVFS("AvelthorneExport-Regular.ttf", font);
  doc.addFont(
    "AvelthorneExport-Regular.ttf",
    "AvelthorneExport",
    "normal",
  );
  doc.setFont("AvelthorneExport", "normal");
  doc.setProperties({
    title,
    author: "Avelthorne People Group",
    creator: "Avelthorne People Group Careers",
    subject: "Applications report",
  });
  const locale = report?.locale ?? "en",
    timeZone = report?.timeZone ?? "UTC";
  const t = reportText[locale];
  const generated = new Intl.DateTimeFormat(
    locale === "zh" ? "zh-CN" : "en-GB",
    { dateStyle: "medium", timeStyle: "short", timeZone },
  ).format(new Date());
  const width = doc.internal.pageSize.getWidth(),
    height = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  const summary = [
    ...(report?.summary ?? []),
    `${t.records}: ${rows.length}`,
  ].join("  |  ");
  const summaryLines: string[] = doc.splitTextToSize(summary, width - 36);
  const tableY = 49 + summaryLines.length * 4 + 5;
  autoTable(doc, {
    head: [report?.pdf?.headers ?? headers],
    body: report?.pdf?.rows ?? rows,
    startY: tableY,
    margin: { top: tableY, right: 14, bottom: 18, left: 14 },
    theme: "plain",
    rowPageBreak: "avoid",
    showHead: "everyPage",
    styles: {
      font: "AvelthorneExport",
      fontStyle: "normal",
      fontSize: 7.8,
      cellPadding: 2.5,
      overflow: "linebreak",
      textColor: "#" + colors.ink,
      valign: "top",
      lineColor: "#" + colors.border,
      lineWidth: { bottom: 0.15 },
    },
    headStyles: {
      fillColor: "#" + colors.accent,
      textColor: "#" + colors.white,
      fontStyle: "normal",
      fontSize: 8.2,
    },
    alternateRowStyles: { fillColor: "#" + colors.paper },
    columnStyles: report?.pdf
      ? Object.fromEntries(
          report.pdf.widths.map((cellWidth, index) => [index, { cellWidth }]),
        )
      : {},
    willDrawPage() {
      doc.setFont("AvelthorneExport", "normal");
      doc.setFillColor("#" + colors.accent);
      doc.rect(14, 11, 8, 8, "F");
      doc.setTextColor("#" + colors.white);
      doc.setFontSize(13);
      doc.text("T", 16, 17);
      doc.setTextColor("#" + colors.ink);
      doc.setFontSize(12);
      doc.text("AVELTHORNE PEOPLE GROUP", 26, 17);
      doc.setTextColor("#" + colors.secondary);
      doc.setFontSize(7.5);
      doc.text(`${t.generated}: ${generated}`, width - 14, 14, {
        align: "right",
      });
      doc.text(timeZone, width - 14, 19, { align: "right" });
      doc.setDrawColor("#" + colors.border);
      doc.setLineWidth(0.25);
      doc.line(14, 24, width - 14, 24);
      doc.setTextColor("#" + colors.ink);
      doc.setFontSize(18);
      doc.text(title, 14, 36);
      doc.setFillColor("#" + colors.soft);
      doc.roundedRect(
        14,
        43,
        width - 28,
        summaryLines.length * 4 + 6,
        1.5,
        1.5,
        "F",
      );
      doc.setTextColor("#" + colors.secondary);
      doc.setFontSize(8);
      doc.text(summaryLines, 18, 48);
    },
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont("AvelthorneExport", "normal");
    doc.setDrawColor("#" + colors.border);
    doc.line(14, height - 13, width - 14, height - 13);
    doc.setFontSize(7);
    doc.setTextColor("#" + colors.secondary);
    doc.text(`Avelthorne People Group - ${t.internal}`, 14, height - 8);
    doc.text(`${t.page} ${page} ${t.of} ${pages}`, width - 14, height - 8, {
      align: "right",
    });
  }
  return doc.output("blob");
}

// Download the completed report without opening a print dialog or an external service.
// Export errors remain available to the calling menu for a visible retry message.
export async function downloadPdf(
  filename: string,
  title: string,
  headers: string[],
  rows: string[][],
  report?: ExportReport,
) {
  triggerDownload(await createPdf(title, headers, rows, report), filename);
}
