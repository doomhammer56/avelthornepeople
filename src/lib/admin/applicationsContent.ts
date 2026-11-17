import type { AdminLang } from "./nav";

// Bilingual labels for the Applications screens (A04: list + detail).
export const applicationsContent: Record<
  AdminLang,
  {
    title: string;
    subtitle: string;
    allJobs: string;
    filter: string;
    columns: {
      candidate: string;
      job: string;
      source: string;
      submitted: string;
      status: string;
      actions: string;
    };
    duplicateTag: string;
    duplicateNote: string;
    facts: {
      job: string;
      email: string;
      phone: string;
      source: string;
      submitted: string;
      consent: string;
    };
    consentValue: string;
    moveStatus: string;
    preview: string;
    download: string;
    actionsPending: string;
    sources: Record<string, string>;
    viewDetails: string;
    backToList: string;
    backToJob: string;
    detailId: string;
    export: string;
    exportEmpty: string;
    contactSearch: string;
    contactHelp: string;
    countryLabel: string;
    clearFilters: string;
    allStages: string;
    listTitle: string;
    emptyResults: string;
    showing: string;
    of: string;
    applicationId: string;
    candidateId: string;
    contact: string;
    timeZone: string;
    pipeline: string;
    notifiedReject: string;
    notifiedInterview: string;
    notifiedOffer: string;
    offerMarked: string;
    notifyFailed: string;
    interviewDialog: {
      title: string;
      help: string;
      modeDetails: string;
      modeLater: string;
      when: string;
      whenPlaceholder: string;
      location: string;
      locationPlaceholder: string;
      meetingLink: string;
      meetingLinkPlaceholder: string;
      note: string;
      notePlaceholder: string;
      cancel: string;
      send: string;
      sending: string;
    };
    offerDialog: {
      title: string;
      help: string;
      modeEmail: string;
      modeLater: string;
      note: string;
      notePlaceholder: string;
      cancel: string;
      send: string;
      sending: string;
      confirm: string;
    };
  }
> = {
  en: {
    title: "Applications",
    subtitle: "Confirmed submissions and their current recruitment status.",
    allJobs: "All jobs",
    filter: "Filter",
    columns: {
      candidate: "Candidate",
      job: "Job",
      source: "Source",
      submitted: "Submitted",
      status: "Status",
      actions: "Actions",
    },
    duplicateTag: "Duplicate",
    duplicateNote:
      "Flagged as a possible match to an existing candidate record.",
    facts: {
      job: "Job",
      email: "Email",
      phone: "Phone",
      source: "Source",
      submitted: "Submitted",
      consent: "Consent",
    },
    consentValue: "Agreed · retained 24 months",
    moveStatus: "Move stage",
    preview: "Preview CV",
    download: "Download CV",
    actionsPending: "Not yet available",
    sources: {
      site: "Website",
      linkedin: "LinkedIn",
      jobstreet: "JobStreet",
      referral: "Referral",
      other: "Other",
    },
    viewDetails: "View details",
    backToList: "Applications",
    backToJob: "View job",
    detailId: "Application",
    export: "Export",
    exportEmpty: "Nothing to export for the current filter.",
    contactSearch: "Exact Contact Search",
    contactHelp:
      "Enter a complete email or phone number. Include a country code for a local phone number.",
    countryLabel: "Country Code",
    clearFilters: "Clear Filters",
    allStages: "All Stages",
    listTitle: "Application Records",
    emptyResults: "No applications match these filters.",
    showing: "Showing",
    of: "of",
    applicationId: "Application ID",
    candidateId: "Candidate ID",
    contact: "Contact",
    timeZone: "Time Zone",
    pipeline: "Recruitment Pipeline",
    notifiedReject: "Stage updated. A rejection email was sent to the candidate.",
    notifiedInterview: "Stage updated. An interview invitation was sent to the candidate.",
    notifiedOffer: "Stage updated. An offer email was sent to the candidate.",
    offerMarked: "Marked as Offer. No email was sent.",
    notifyFailed:
      "Stage updated, but the email could not be sent. Check delivery settings and try again.",
    interviewDialog: {
      title: "Invite to interview",
      help: "This is sent to the candidate as soon as you send the invite.",
      modeDetails: "Include the details in this email",
      modeLater: "We'll follow up separately",
      when: "Date & time",
      whenPlaceholder: "e.g. Thu 6 Nov, 10:00 (GMT+8)",
      location: "Venue (optional)",
      locationPlaceholder: "e.g. Tricore Customer Care LLC, Level 12, Kuala Lumpur",
      meetingLink: "Meeting link (optional)",
      meetingLinkPlaceholder: "e.g. https://meet.google.com/...",
      note: "Extra note (optional)",
      notePlaceholder: "Anything else to include in the invite",
      cancel: "Cancel",
      send: "Send invite",
      sending: "Sending…",
    },
    offerDialog: {
      title: "Mark as Offer",
      help: "Choose whether to email the offer now, or just mark the stage because you'll contact the candidate directly.",
      modeEmail: "Send the offer by email",
      modeLater: "I'll contact them separately",
      note: "Extra note (optional)",
      notePlaceholder: "Anything else to include in the offer email",
      cancel: "Cancel",
      send: "Confirm",
      sending: "Saving…",
      confirm: "No email will be sent to the candidate.",
    },
  },
  zh: {
    title: "投递管理",
    subtitle: "已确认的投递及其当前招聘状态。",
    allJobs: "全部职位",
    filter: "筛选",
    columns: {
      candidate: "候选人",
      job: "职位",
      source: "来源",
      submitted: "提交时间",
      status: "状态",
      actions: "操作",
    },
    duplicateTag: "重复",
    duplicateNote: "此投递被标记为可能匹配已有候选人记录。",
    facts: {
      job: "应聘职位",
      email: "邮箱",
      phone: "手机",
      source: "来源",
      submitted: "提交时间",
      consent: "隐私同意",
    },
    consentValue: "已同意 · 保存 24 个月",
    moveStatus: "推进状态",
    preview: "预览简历",
    download: "下载简历",
    actionsPending: "暂未开放",
    sources: {
      site: "官网",
      linkedin: "LinkedIn",
      jobstreet: "JobStreet",
      referral: "内推",
      other: "其他",
    },
    viewDetails: "查看详情",
    backToList: "投递管理",
    backToJob: "查看职位",
    detailId: "投递",
    export: "导出",
    exportEmpty: "当前筛选条件下没有可导出的内容。",
    contactSearch: "精确联系方式搜索",
    contactHelp:
      "请输入完整邮箱或手机号码。本地号码需填写国家代码。",
    countryLabel: "国家代码",
    clearFilters: "清除筛选",
    allStages: "全部阶段",
    listTitle: "投递记录",
    emptyResults: "没有符合筛选条件的投递。",
    showing: "显示",
    of: "/",
    applicationId: "投递 ID",
    candidateId: "候选人 ID",
    contact: "联系方式",
    timeZone: "时区",
    pipeline: "招聘流程",
    notifiedReject: "状态已更新，拒信已发送给候选人。",
    notifiedInterview: "状态已更新，面试邀请已发送给候选人。",
    notifiedOffer: "状态已更新，录用通知已发送给候选人。",
    offerMarked: "已标记为录用，未发送邮件。",
    notifyFailed: "状态已更新，但邮件发送失败。请检查邮件配置后重试。",
    interviewDialog: {
      title: "邀请面试",
      help: "发送邀请后将立即发给候选人。",
      modeDetails: "在邮件中包含具体信息",
      modeLater: "稍后另行通知",
      when: "面试时间",
      whenPlaceholder: "例如：11月6日（周四）10:00（GMT+8）",
      location: "地点（选填）",
      locationPlaceholder: "例如：Tricore Customer Care LLC，吉隆坡 12 楼",
      meetingLink: "会议链接（选填）",
      meetingLinkPlaceholder: "例如：https://meet.google.com/...",
      note: "附加说明（选填）",
      notePlaceholder: "邀请邮件中需要补充的其他信息",
      cancel: "取消",
      send: "发送邀请",
      sending: "发送中…",
    },
    offerDialog: {
      title: "标记为录用",
      help: "选择立即发送录用邮件，或仅标记状态（您将直接另行联系候选人）。",
      modeEmail: "通过邮件发送录用通知",
      modeLater: "我会另行联系候选人",
      note: "附加说明（选填）",
      notePlaceholder: "录用邮件中需要补充的其他信息",
      cancel: "取消",
      send: "确认",
      sending: "保存中…",
      confirm: "不会向候选人发送邮件。",
    },
  },
};
