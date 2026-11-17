import type { ImportIssueCode } from "./jobImport/validate.ts";
import type { SheetIssueCode } from "./jobImport/parse.ts";

type Messages = {
  title: string;
  intro: string;
  back: string;
  stepTemplate: string;
  stepUpload: string;
  stepPreview: string;
  downloadTemplate: string;
  preparingTemplate: string;
  templateFailed: string;
  chooseFile: string;
  chooseAnother: string;
  reading: string;
  fileSummary: string;
  unknownColumns: string;
  missingMarker: string;
  fileProblem: string;
  checking: string;
  previewFailed: string;
  columns: {
    row: string;
    job: string;
    project: string;
    status: string;
    details: string;
  };
  status: Record<"ok" | "error" | "duplicate" | "skipped", string>;
  action: Record<"create" | "overwrite" | "skip", string>;
  duplicatesTitle: string;
  duplicatesBody: string;
  skipAll: string;
  overwriteAll: string;
  choose: string;
  skip: string;
  overwrite: string;
  existingJob: string;
  summary: string;
  cantConfirm: string;
  confirm: string;
  cancel: string;
  importing: string;
  doneTitle: string;
  done: string;
  viewJobs: string;
  importAnother: string;
  conflict: string;
  denied: string;
  rejected: string;
  failed: string;
  historyTitle: string;
  historyEmpty: string;
  historyColumns: { when: string; who: string; file: string; result: string };
  historyResult: string;
  failedImport: string;
  unknownActor: string;
  emptyColumn: string;
  issues: Record<ImportIssueCode, string>;
  sheetIssues: Record<SheetIssueCode, string>;
  otherRow: string;
};

export const jobImportContent: Record<"en" | "zh", Messages> = {
  en: {
    title: "Import jobs",
    intro:
      "Upload the Excel template to create several job drafts at once. Nothing is saved until every row passes and you confirm. Imported jobs are drafts; an administrator still publishes each one.",
    back: "Back to jobs",
    stepTemplate: "1. Download the template",
    stepUpload: "2. Upload your file",
    stepPreview: "3. Review and confirm",
    downloadTemplate: "Download template (.xlsx)",
    preparingTemplate: "Preparing…",
    templateFailed: "The template could not be created. Reload and retry.",
    chooseFile: "Choose Excel file",
    chooseAnother: "Choose another file",
    reading: "Reading file…",
    fileSummary: "{name} · {count} rows",
    unknownColumns:
      "These columns are not part of the template and are ignored:",
    missingMarker:
      "This file has no template marker. It was accepted because its columns match, but download the template to be safe.",
    fileProblem: "This file cannot be imported:",
    checking: "Checking rows…",
    previewFailed: "The rows could not be checked. Retry, or reload the page.",
    columns: {
      row: "Row",
      job: "Job title",
      project: "Project",
      status: "Result",
      details: "Details",
    },
    status: {
      ok: "Ready",
      error: "Error",
      duplicate: "Duplicate",
      skipped: "Skipped",
    },
    action: {
      create: "Will be created",
      overwrite: "Will overwrite",
      skip: "Will be skipped",
    },
    duplicatesTitle: "Existing jobs found",
    duplicatesBody:
      "{count} rows have the same title and project as a job that already exists. Choose what to do with them, or cancel the import.",
    skipAll: "Skip all duplicates",
    overwriteAll: "Overwrite all duplicates",
    choose: "Choose…",
    skip: "Skip",
    overwrite: "Overwrite",
    existingJob: "Existing job",
    summary:
      "{create} to create · {overwrite} to overwrite · {skipped} skipped · {errors} with errors",
    cantConfirm:
      "Fix every error and resolve every duplicate to enable the import.",
    confirm: "Confirm import",
    cancel: "Cancel",
    importing: "Importing…",
    doneTitle: "Import complete",
    done: "{created} created · {overwritten} overwritten · {skipped} skipped.",
    viewJobs: "View jobs",
    importAnother: "Import another file",
    conflict:
      "A job changed or this import was already processed. Nothing was saved. Check the history below, then upload the file again.",
    denied: "You do not have permission to import jobs.",
    rejected:
      "The rows no longer pass validation. Nothing was saved; review the updated results.",
    failed:
      "The import failed and nothing was saved. Retry, or check the history below.",
    historyTitle: "Import history",
    historyEmpty: "No imports yet.",
    historyColumns: { when: "When", who: "By", file: "File", result: "Result" },
    historyResult:
      "{created} created · {overwritten} overwritten · {skipped} skipped",
    failedImport: "Failed — nothing saved ({failed} rows)",
    unknownActor: "—",
    emptyColumn: "(blank)",
    otherRow: "row {n}",
    issues: {
      required: "A value is required.",
      invalid: "This value is not valid.",
      invalid_option:
        "Not a valid option. Use a value from the Reference sheet.",
      ambiguous_option:
        "Matches more than one option. Use the code from the Reference sheet.",
      invalid_number:
        "Enter a number using digits and at most one decimal point.",
      precision: "Use at most two decimal places.",
      invalid_range: "The maximum must not be below the minimum.",
      too_long: "This value is too long.",
      too_many:
        "Too many lines or locations (up to 50 lines and 30 locations).",
      incomplete_group:
        "Fill every column in this group, or leave them all blank.",
      salary_required: "Showing the salary needs a complete salary range.",
      duplicate_in_file: "Same title and project as {row}.",
      ambiguous_duplicate: "Several existing jobs match. Skip this row.",
      settings_locked:
        "The existing job's settings are locked and differ from this row. Skip it, or edit that job directly.",
    },
    sheetIssues: {
      file_too_large: "The file is larger than 2 MB.",
      not_xlsx: "This is not a valid .xlsx file.",
      template_mismatch:
        "This file was built from a different template version. Download the current template.",
      missing_sheet: "The workbook has no Jobs sheet.",
      missing_columns: "Required columns are missing: {columns}.",
      duplicate_columns: "These columns appear more than once: {columns}.",
      too_many_rows:
        "The file has more than 200 rows. Split it into smaller files.",
      empty: "The file has no rows to import.",
    },
  },
  zh: {
    title: "导入职位",
    intro:
      "上传 Excel 模板即可一次创建多个职位草稿。所有行通过校验并确认前不会保存任何内容。导入的职位均为草稿，仍需管理员逐个发布。",
    back: "返回职位列表",
    stepTemplate: "1. 下载模板",
    stepUpload: "2. 上传文件",
    stepPreview: "3. 检查并确认",
    downloadTemplate: "下载模板 (.xlsx)",
    preparingTemplate: "正在准备…",
    templateFailed: "无法生成模板，请重新加载后重试。",
    chooseFile: "选择 Excel 文件",
    chooseAnother: "重新选择文件",
    reading: "正在读取文件…",
    fileSummary: "{name} · {count} 行",
    unknownColumns: "以下列不属于模板，将被忽略：",
    missingMarker: "此文件没有模板标记；因列名匹配而被接受，建议重新下载模板。",
    fileProblem: "无法导入此文件：",
    checking: "正在检查…",
    previewFailed: "无法检查这些行，请重试或刷新页面。",
    columns: {
      row: "行号",
      job: "岗位名称",
      project: "项目",
      status: "结果",
      details: "详情",
    },
    status: {
      ok: "可导入",
      error: "有错误",
      duplicate: "重复",
      skipped: "已跳过",
    },
    action: { create: "将创建", overwrite: "将覆盖", skip: "将跳过" },
    duplicatesTitle: "发现已有职位",
    duplicatesBody:
      "有 {count} 行与已存在职位的标题和项目相同。请选择处理方式，或取消导入。",
    skipAll: "全部跳过",
    overwriteAll: "全部覆盖",
    choose: "请选择…",
    skip: "跳过",
    overwrite: "覆盖",
    existingJob: "已有职位",
    summary:
      "创建 {create} · 覆盖 {overwrite} · 跳过 {skipped} · 错误 {errors}",
    cantConfirm: "请修正所有错误并处理所有重复项后才能导入。",
    confirm: "确认导入",
    cancel: "取消",
    importing: "正在导入…",
    doneTitle: "导入完成",
    done: "已创建 {created} · 已覆盖 {overwritten} · 已跳过 {skipped}。",
    viewJobs: "查看职位",
    importAnother: "导入其他文件",
    conflict:
      "有职位已被修改，或此次导入已处理过。未保存任何内容。请查看下方历史记录后重新上传文件。",
    denied: "您没有导入职位的权限。",
    rejected: "这些行已不再通过校验。未保存任何内容，请查看更新后的结果。",
    failed: "导入失败，未保存任何内容。请重试或查看下方历史记录。",
    historyTitle: "导入记录",
    historyEmpty: "暂无导入记录。",
    historyColumns: {
      when: "时间",
      who: "操作人",
      file: "文件",
      result: "结果",
    },
    historyResult: "创建 {created} · 覆盖 {overwritten} · 跳过 {skipped}",
    failedImport: "失败，未保存（{failed} 行）",
    unknownActor: "—",
    emptyColumn: "（空）",
    otherRow: "第 {n} 行",
    issues: {
      required: "此项为必填。",
      invalid: "此值无效。",
      invalid_option: "不是有效选项，请使用 Reference 工作表中的值。",
      ambiguous_option: "匹配到多个选项，请使用 Reference 工作表中的代码。",
      invalid_number: "请输入数字，仅含数字和最多一个小数点。",
      precision: "最多保留两位小数。",
      invalid_range: "最高值不得低于最低值。",
      too_long: "内容过长。",
      too_many: "行数或地点过多（最多 50 行、30 个地点）。",
      incomplete_group: "此组各列须全部填写或全部留空。",
      salary_required: "显示薪资需要完整的薪资范围。",
      duplicate_in_file: "与{row}的标题和项目相同。",
      ambiguous_duplicate: "匹配到多个已有职位，请跳过此行。",
      settings_locked:
        "已有职位的设置已锁定且与此行不同。请跳过，或直接编辑该职位。",
    },
    sheetIssues: {
      file_too_large: "文件超过 2 MB。",
      not_xlsx: "这不是有效的 .xlsx 文件。",
      template_mismatch: "此文件基于不同版本的模板，请下载最新模板。",
      missing_sheet: "工作簿中没有 Jobs 工作表。",
      missing_columns: "缺少必填列：{columns}。",
      duplicate_columns: "以下列重复出现：{columns}。",
      too_many_rows: "文件超过 200 行，请拆分为较小的文件。",
      empty: "文件中没有可导入的行。",
    },
  },
};

export function fill(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_, key: string) =>
    String(values[key] ?? ""),
  );
}
