import type { AdminLang } from "./nav";

// Bilingual labels for the Job Editor screen (A02/A03/A08).
export const jobEditorContent: Record<
  AdminLang,
  {
    back: string;
    newHeading: string;
    saveDraft: string;
    submitReview: string;
    publish: string;
    tabFilled: string;
    tabMissing: string;
    titleLabel: string;
    titlePlaceholder: string;
    duties: string;
    dutiesHint: string;
    requirements: string;
    settingsHeading: string;
    settingsNote: string;
    settingsLockedNote: string;
    settingsLockNote: string;
    department: string;
    location: string;
    type: string;
    experience: string;
    salaryRange: string;
    salaryPlaceholder: string;
    showSalary: string;
    scheduleHeading: string;
    postedDate: string;
    closingDate: string;
    scheduleNote: string;
    siteUrl: string;
    titleRequired: string;
    modalTitle: string;
    modalBody: string;
    modalFillEnglish: string;
    modalPublishAnyway: string;
    cancel: string;
    savedNotice: string;
    step1: string;
    step2: string;
    step3: string;
    stepOf: (step: number, total: number) => string;
    stepNext: string;
    stepBack: string;
    reviewNote: string;
    languageNote: string;
    requiredNote: string;
    tabOptional: string;
  }
> = {
  en: {
    back: "Jobs",
    newHeading: "New job",
    saveDraft: "Save draft",
    submitReview: "Submit for review",
    publish: "Publish to site",
    tabFilled: "Filled in",
    tabMissing: "Missing",
    titleLabel: "Job title",
    titlePlaceholder: "e.g. Customer Operations Lead",
    duties: "Responsibilities",
    dutiesHint: "One per line",
    requirements: "Requirements",
    settingsHeading: "Job settings",
    settingsNote: "Shared by both languages",
    settingsLockedNote:
      "These settings are shared by all languages and are read-only after the first complete save.",
    settingsLockNote:
      "Settings are shared by all languages. Once saved with all required settings completed, this page becomes read-only.",
    department: "Department",
    location: "Location",
    type: "Job type",
    experience: "Experience",
    salaryRange: "Salary range",
    salaryPlaceholder: "e.g. PHP 60K–80K / month",
    showSalary: "Show salary on the site",
    scheduleHeading: "Scheduled publishing",
    postedDate: "Posted date",
    closingDate: "Closing date",
    scheduleNote:
      "Closes automatically and leaves the site once the closing date passes (checked every 10 minutes).",
    siteUrl: "Site URL",
    titleRequired: "Complete at least one language to publish.",
    modalTitle: "English content isn't filled in yet",
    modalBody:
      'This job only has Chinese content. English visitors will see the Chinese version labelled "English version not available."',
    modalFillEnglish: "Add English content",
    modalPublishAnyway: "Publish anyway",
    cancel: "Cancel",
    savedNotice: "Changes made here are not saved yet.",
    step1: "Job Details",
    step2: "Settings & Schedule",
    step3: "Review & Publish",
    stepOf: (step, total) => `Step ${step} of ${total}`,
    stepNext: "Next",
    stepBack: "Back",
    reviewNote: "Check everything below, then save, submit or publish.",
    languageNote:
      "Complete English, Chinese, or both. Leave an unused language blank; if you start a translation, complete all three fields.",
    requiredNote:
      "* Required for publishing. Drafts can be saved before all required fields are completed.",
    tabOptional: "Not added (optional)",
  },
  zh: {
    back: "职位管理",
    newHeading: "新建职位",
    saveDraft: "保存草稿",
    submitReview: "提交审核",
    publish: "发布到官网",
    tabFilled: "已填写",
    tabMissing: "缺失",
    titleLabel: "职位标题",
    titlePlaceholder: "例如：客户运营主管",
    duties: "岗位职责",
    dutiesHint: "每行一条",
    requirements: "任职要求",
    settingsHeading: "职位设置",
    settingsNote: "中英共用",
    settingsLockedNote: "这些设置由所有语言共用，首次完整保存后为只读。",
    settingsLockNote:
      "这些设置由所有语言共用。填写所有必填设置并保存后，此页面将变为只读。",
    department: "部门",
    location: "地点",
    type: "工作类型",
    experience: "经验要求",
    salaryRange: "薪资范围",
    salaryPlaceholder: "例如 PHP 60K–80K / 月",
    showSalary: "官网显示薪资",
    scheduleHeading: "定时上下架",
    postedDate: "发布日期",
    closingDate: "截止日期",
    scheduleNote: "到达截止日后自动关闭并从官网移除（每 10 分钟检查一次）。",
    siteUrl: "官网地址",
    titleRequired: "发布前请至少完整填写一种语言。",
    modalTitle: "英文版尚未填写",
    modalBody:
      "此职位只填写了中文。English 访客将看到中文内容，并标注 “English version not available”。",
    modalFillEnglish: "补充英文",
    modalPublishAnyway: "仍然发布",
    cancel: "取消",
    savedNotice: "此处的修改暂不会保存。",
    step1: "职位详情",
    step2: "设置与排期",
    step3: "核对并发布",
    stepOf: (step, total) => `第 ${step} / ${total} 步`,
    stepNext: "下一步",
    stepBack: "上一步",
    reviewNote: "请核对以下信息，然后保存草稿、提交审核或发布。",
    languageNote:
      "可完整填写英文、中文或两种语言。不使用的语言请留空；开始填写一种语言后，请完成全部三个字段。",
    requiredNote: "* 为发布时的必填项。未填写完整时仍可保存草稿。",
    tabOptional: "未添加（可选）",
  },
};
