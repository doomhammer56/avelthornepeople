// Keep vacancy labels and availability feedback bilingual and independent of data.
// Backend job records can replace fixtures without changing navigation or presentation copy.
export const jobDetailContent = {
  en: {
    back: "Back To Jobs",
    share: "Share Job",
    copied: "Link Copied",
    shareFailed: "Copy This Link",
    salary: "Salary Range",
    closed: "Position Closed",
    closedDescription:
      "This position is no longer accepting applications. Browse our current vacancies.",
    related: "Related Jobs",
    relatedUnavailable: "Related jobs are temporarily unavailable.",
    noRelated: "No related openings are currently available.",
    department: "Team",
    location: "Location",
    type: "Type",
    posted: "Posted",
    responsibilities: "Responsibilities",
    requirements: "Requirements",
    applyTitle: "Apply For This Job",
    /** Full line minus “— about 3 minutes. Our recruitment team will review your application.” */
    applyDescription: "Fill in your details and upload a CV.",
    apply: "Apply Now",
    closes: "Closes",
    preview: "Preview vacancy — sample content for design review.",
    missingTitle: "Job No Longer Available",
    missingDescription:
      "This role may have closed or the link may be incorrect. Browse our current vacancies.",
    unavailableTitle: "Job Details Are Temporarily Unavailable",
    unavailableDescription:
      "Please try again to see the latest information for this role.",
    retry: "Try Again",
    loading: "Loading job details…",
  },
  zh: {
    back: "返回职位列表",
    share: "分享职位",
    copied: "链接已复制",
    shareFailed: "复制此链接",
    salary: "薪资范围",
    closed: "职位已关闭",
    closedDescription: "该职位已停止接收申请。请查看当前在招职位。",
    related: "相关职位",
    relatedUnavailable: "暂时无法加载相关职位。",
    noRelated: "目前没有相关在招职位。",
    department: "团队",
    location: "地点",
    type: "类型",
    posted: "发布",
    responsibilities: "岗位职责",
    requirements: "任职要求",
    applyTitle: "投递此职位",
    /** Full line minus “约需 3 分钟。招聘团队将审核你的申请。” */
    applyDescription: "在线填写信息并上传简历。",
    apply: "投递简历",
    closes: "截止日期",
    preview: "职位预览 — 当前为设计审核示例内容。",
    missingTitle: "该职位已不可用",
    missingDescription: "该职位可能已关闭，或链接不正确。请查看当前在招职位。",
    unavailableTitle: "暂时无法加载职位详情",
    unavailableDescription: "请重试以查看该职位的最新信息。",
    retry: "重试",
    loading: "正在加载职位详情…",
  },
};
export type JobDetailContent =
  (typeof jobDetailContent)[keyof typeof jobDetailContent];
