import type { AdminLang } from "./nav";

// Shared labels for the admin data-table controls (pagination + bulk actions).
export const tableContent = {
  en: {
    pagination: "Pagination",
    showing: (from: number, to: number, total: number) =>
      `Showing ${from}–${to} of ${total}`,
    showingUnknown: (from: number, to: number) => `Showing ${from}–${to}`,
    none: "No results",
    rowsPerPage: "Rows per page",
    first: "First page",
    previous: "Previous page",
    next: "Next page",
    last: "Last page",
    page: (page: number) => `Page ${page}`,
    selectAll: "Select all rows on this page",
    selectRow: "Select row",
    selected: (count: number) => `${count} selected`,
    clear: "Clear selection",
    working: "Working…",
    confirm: "Confirm",
    cancel: "Cancel",
  },
  zh: {
    pagination: "分页",
    showing: (from: number, to: number, total: number) =>
      `显示第 ${from}–${to} 条，共 ${total} 条`,
    showingUnknown: (from: number, to: number) => `显示第 ${from}–${to} 条`,
    none: "没有结果",
    rowsPerPage: "每页条数",
    first: "第一页",
    previous: "上一页",
    next: "下一页",
    last: "最后一页",
    page: (page: number) => `第 ${page} 页`,
    selectAll: "选择本页全部行",
    selectRow: "选择此行",
    selected: (count: number) => `已选择 ${count} 项`,
    clear: "取消选择",
    working: "处理中…",
    confirm: "确认",
    cancel: "取消",
  },
} satisfies Record<AdminLang, unknown>;
