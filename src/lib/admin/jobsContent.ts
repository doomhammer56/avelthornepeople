import type { AdminLang } from "./nav";

// Bilingual labels for the Jobs list screen (A02/A03).
export const jobsContent: Record<
  AdminLang,
  {
    title: string;
    checkExpired: string;
    newJob: string;
    searchPlaceholder: string;
    all: string;
    columns: {
      job: string;
      department: string;
      location: string;
      status: string;
      site: string;
      closes: string;
      applications: string;
      actions: string;
    };
    edit: string;
    publish: string;
    unpublish: string;
    copy: string;
    readOnly: string;
    expired: string;
    live: string;
    offline: string;
    noResults: string;
    syncTitle: string;
    syncNote: string;
    syncEmpty: string;
    actionsPending: string;
    missingEnglish: string;
    importJob: string;
    importTitle: string;
    importInstructions: string;
    importFileLabel: string;
    importPreviewHeading: (count: number) => string;
    importConfirm: (count: number) => string;
    importCancel: string;
    importNoFile: string;
    importParseError: string;
    importSuccess: (count: number) => string;
  }
> = {
  en: {
    title: "Jobs",
    checkExpired: "Check expired jobs",
    newJob: "New job",
    searchPlaceholder: "Search job title or ID",
    all: "All",
    columns: {
      job: "Job",
      department: "Department",
      location: "Location",
      status: "Status",
      site: "Site",
      closes: "Closes",
      applications: "Applications",
      actions: "Actions",
    },
    edit: "Edit",
    publish: "Publish",
    unpublish: "Unpublish",
    copy: "Copy",
    readOnly: "Read-only",
    expired: "expired",
    live: "Live",
    offline: "Offline",
    noResults: "No jobs match these filters.",
    syncTitle: "Sync log",
    syncNote: "Console → site · target ≤ 60s",
    syncEmpty: "No publishing activity has been recorded yet.",
    actionsPending: "Not yet available",
    missingEnglish: "English missing",
    importJob: "Import from sheet",
    importTitle: "Import jobs",
    importInstructions:
      "Upload a CSV with columns: Chinese title, English title, Department ID, Location ID, Type ID, Salary. IDs must match the Settings screen's lists. The first row is treated as a header.",
    importFileLabel: "CSV file",
    importPreviewHeading: (count) =>
      `${count} row${count === 1 ? "" : "s"} ready to import`,
    importConfirm: (count) => `Create ${count} job${count === 1 ? "" : "s"}`,
    importCancel: "Cancel",
    importNoFile: "Choose a CSV file first.",
    importParseError:
      "Couldn't read that file as CSV with the expected columns.",
    importSuccess: (count) =>
      `${count} job${count === 1 ? "" : "s"} ready to create — not yet saved.`,
  },
  zh: {
    title: "职位管理",
    checkExpired: "检查到期职位",
    newJob: "新建职位",
    searchPlaceholder: "搜索职位名称或编号",
    all: "全部",
    columns: {
      job: "职位",
      department: "部门",
      location: "地点",
      status: "状态",
      site: "官网",
      closes: "截止",
      applications: "投递",
      actions: "操作",
    },
    edit: "编辑",
    publish: "上架",
    unpublish: "下架",
    copy: "复制",
    readOnly: "只读",
    expired: "已过期",
    live: "在线",
    offline: "离线",
    noResults: "没有符合条件的职位",
    syncTitle: "同步记录",
    syncNote: "后台 → 官网 · 目标 ≤ 60 秒",
    syncEmpty: "暂无发布记录。",
    actionsPending: "暂未开放",
    missingEnglish: "英文版缺失",
    importJob: "从表格导入",
    importTitle: "导入职位",
    importInstructions:
      "上传包含以下列的 CSV 文件：中文标题、英文标题、部门编号、地点编号、类型编号、薪资。编号需与系统设置中的列表一致。第一行将作为表头处理。",
    importFileLabel: "CSV 文件",
    importPreviewHeading: (count) => `共 ${count} 条待导入`,
    importConfirm: (count) => `创建 ${count} 个职位`,
    importCancel: "取消",
    importNoFile: "请先选择 CSV 文件。",
    importParseError: "无法按预期列读取该文件。",
    importSuccess: (count) => `${count} 个职位待创建 — 尚未保存。`,
  },
};
