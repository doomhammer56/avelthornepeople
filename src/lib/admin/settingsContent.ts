import type { AdminLang } from "./nav";

export type SettingsCategoryId =
  "department" | "location" | "jobType" | "experience";

// Bilingual labels for the Settings screen — where admins manage the
// department/location/job type/experience lists the Job Editor's dropdowns
// read from, instead of a developer hard-coding the options.
export const settingsContent: Record<
  AdminLang,
  {
    title: string;
    subtitle: string;
    categories: Record<SettingsCategoryId, string>;
    columns: {
      nameEn: string;
      nameZh: string;
      status: string;
      actions: string;
    };
    active: string;
    inactive: string;
    toggle: string;
    addNew: string;
    nameEnPlaceholder: string;
    nameZhPlaceholder: string;
    add: string;
    cancel: string;
    empty: string;
    savedNotice: string;
    nameRequired: string;
    noPermTitle: string;
    noPermBody: string;
    code: string;
    edit: string;
    save: string;
    saving: string;
    activeLabel: string;
    countryCode: string;
    timeZone: string;
    addressEn: string;
    addressZh: string;
    invalid: string;
    failed: string;
    conflict: string;
    descriptions: Record<SettingsCategoryId, string>;
    codeHelp: string;
    editing: string;
    adding: string;
    editorHelp: string;
    locationDetails: string;
  }
> = {
  en: {
    title: "Settings",
    subtitle:
      "Manage the department, location, job type and experience lists the job editor's dropdowns use. Add an option here before it can be selected on a job.",
    categories: {
      department: "Departments",
      location: "Locations",
      jobType: "Job Types",
      experience: "Experience Levels",
    },
    columns: {
      nameEn: "English",
      nameZh: "中文",
      status: "Status",
      actions: "Actions",
    },
    active: "Active",
    inactive: "Inactive",
    toggle: "Toggle status",
    addNew: "Add option",
    nameEnPlaceholder: "English name",
    nameZhPlaceholder: "Chinese name",
    add: "Add",
    cancel: "Cancel",
    empty: "No options yet.",
    savedNotice: "Option saved.",
    code: "Code",
    codeHelp:
      "Use uppercase letters, numbers and underscores. The code stays fixed after creation.",
    editing: "Edit Option",
    adding: "Add Option",
    editorHelp: "Provide both language versions for use in the job editor.",
    locationDetails: "Location Details",
    descriptions: {
      department: "Organize jobs by team or function.",
      location: "Manage office locations and scheduling time zones.",
      jobType: "Manage the employment types available on jobs.",
      experience: "Manage experience levels used in job filters.",
    },
    edit: "Edit",
    save: "Save",
    saving: "Saving…",
    activeLabel: "Active — available for selection",
    countryCode: "Country Code",
    timeZone: "Time Zone",
    addressEn: "English address (optional)",
    addressZh: "Chinese address (optional)",
    invalid: "Check the code, both names and location details.",
    failed: "Could not save. Please try again.",
    conflict:
      "This option changed or the code is already used. Reload the page and try again.",
    nameRequired: "Both names are required.",
    noPermTitle: "No permission to view this page",
    noPermBody:
      "Settings is visible to Admin only. Contact a recruitment lead if you need access.",
  },
  zh: {
    title: "系统设置",
    subtitle:
      "管理职位编辑器下拉菜单使用的部门、地点、工作类型与经验要求列表。需先在此添加选项，才能在职位中选用。",
    categories: {
      department: "部门",
      location: "地点",
      jobType: "工作类型",
      experience: "经验要求",
    },
    columns: {
      nameEn: "英文",
      nameZh: "中文",
      status: "状态",
      actions: "操作",
    },
    active: "启用",
    inactive: "停用",
    toggle: "切换状态",
    addNew: "添加选项",
    nameEnPlaceholder: "英文名称",
    nameZhPlaceholder: "中文名称",
    add: "添加",
    cancel: "取消",
    empty: "暂无选项。",
    savedNotice: "选项已保存。",
    code: "代码",
    codeHelp: "使用大写字母、数字及下划线，创建后不可修改代码。",
    editing: "编辑选项",
    adding: "添加选项",
    editorHelp: "请提供中英文内容，供职位编辑器使用。",
    locationDetails: "地点信息",
    descriptions: {
      department: "按团队或职能对职位分类。",
      location: "管理办公地点及排期时区。",
      jobType: "管理职位可使用的雇佣类型。",
      experience: "管理职位筛选使用的经验要求。",
    },
    edit: "编辑",
    save: "保存",
    saving: "正在保存…",
    activeLabel: "启用 — 可在职位中选择",
    countryCode: "国家代码",
    timeZone: "时区",
    addressEn: "英文地址（选填）",
    addressZh: "中文地址（选填）",
    invalid: "请检查代码、中英文名称及地点信息。",
    failed: "保存失败，请重试。",
    conflict: "选项已更改或代码已存在，请刷新页面后重试。",
    nameRequired: "请填写中英文名称。",
    noPermTitle: "无权限访问",
    noPermBody: "系统设置仅管理员可见。如需开通，请联系招聘负责人。",
  },
};
