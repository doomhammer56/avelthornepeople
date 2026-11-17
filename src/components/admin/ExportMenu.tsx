"use client";

import { useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  FileText,
  File,
  LoaderCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { downloadCsv, downloadPdf, downloadXlsx } from "@/lib/admin/exportFile";
import type { ExportReport } from "@/lib/admin/exportReport";
import type { AdminLang } from "@/lib/admin/nav";

type Props = {
  label: string;
  title: string;
  sheetName: string;
  filenamePrefix: string;
  headers: string[];
  rows: string[][];
  onEmpty: () => void;
  lang: AdminLang;
  report?: ExportReport;
  disabled?: boolean;
};
const text = {
  en: {
    preparing: "Preparing Export…",
    failed: "Unable to create this export. Please try again.",
    excel: "Excel Workbook",
    pdf: "PDF Report",
    csv: "CSV File",
  },
  zh: {
    preparing: "正在准备导出…",
    failed: "无法生成导出文件，请重试。",
    excel: "Excel 工作簿",
    pdf: "PDF 报告",
    csv: "CSV 文件",
  },
};

// Keep export actions explicit, themed and limited to the rows supplied by the screen.
// Pending downloads block duplicate requests and failures produce a visible retry message.
export function ExportMenu({
  label,
  title,
  sheetName,
  filenamePrefix,
  headers,
  rows,
  onEmpty,
  lang,
  report,
  disabled = false,
}: Props) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const t = text[lang];

  // Generate files locally only after the user chooses a format.
  // No candidate data is sent to an export service, browser storage or diagnostic logs.
  async function run(format: "xlsx" | "pdf" | "csv") {
    if (inFlight.current || disabled) return;
    if (!rows.length) {
      onEmpty();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `${filenamePrefix}-${date}.${format}`;
    try {
      if (format === "xlsx")
        await downloadXlsx(filename, sheetName, headers, rows, report);
      else if (format === "pdf")
        await downloadPdf(filename, title, headers, rows, report);
      else downloadCsv(filename, headers, rows);
    } catch {
      toast.error(t.failed);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" disabled={disabled || busy}>
            {busy ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Download aria-hidden="true" />
            )}
            {busy ? t.preparing : label}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem onClick={() => void run("xlsx")}>
          <FileSpreadsheet aria-hidden="true" />
          <span>{t.excel}</span>
          <span className="ml-auto text-xs text-muted-foreground">.xlsx</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run("pdf")}>
          <FileText aria-hidden="true" />
          <span>{t.pdf}</span>
          <span className="ml-auto text-xs text-muted-foreground">.pdf</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run("csv")}>
          <File aria-hidden="true" />
          <span>{t.csv}</span>
          <span className="ml-auto text-xs text-muted-foreground">.csv</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
