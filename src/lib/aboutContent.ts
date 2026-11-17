import type { Locale } from "./homeContent";

// Describe only the public fields used by the About screen.
// Content from the future API can replace these fixtures without changing the UI.
export type AboutContent = {
  eyebrow: string;
  title: string;
  introduction: string;
  missionEyebrow: string;
  mission: { label: string; statement: string }[];
  historyHeading: string;
  historySubheading: string;
  history: { year: string; description: string }[];
};

// Keep the handoff's English and Chinese copy together for editorial review.
// English headings follow the approved Title Case convention.
export const aboutContent: Record<Locale, AboutContent> = {
  en: {
    eyebrow: "About Us",
    title: "Ten Years Focused On Operations.",
    introduction:
      "Avelthorne People Group brings together people, expertise and opportunity to support the work we do and the teams we build.",
    missionEyebrow: "Mission & Vision",
    mission: [
      {
        label: "Our Mission",
        statement:
          "To bring together people, expertise and opportunity to create a positive and lasting impact through the work we do.",
      },
      {
        label: "Our Vision",
        statement:
          "To be a trusted people partner, recognised for supporting organisations and individuals to realise their potential.",
      },
    ],
    historyHeading: "Our History",
    historySubheading: "Company Milestones",
    history: [
      {
        year: "2016",
        description: "Founded in Kuala Lumpur with a 12-person support team",
      },
      { year: "2018", description: "Manila operations centre opens" },
      { year: "2021", description: "London technology hub opens" },
      { year: "2024", description: "Headcount passes 1,000" },
      {
        year: "2026",
        description: "Serving clients in 30 countries and regions",
      },
    ],
  },
  zh: {
    eyebrow: "关于我们",
    title: "专注运营服务十年。",
    introduction:
      "Avelthorne People Group 汇聚人才、专业与机遇，支撑我们所做的工作与所组建的团队。",
    missionEyebrow: "使命与愿景",
    mission: [
      {
        label: "我们的使命",
        statement:
          "汇聚人才、专业与机遇，通过我们所做的工作创造积极而持久的影响。",
      },
      {
        label: "我们的愿景",
        statement:
          "成为值得信赖的人才伙伴，以支持组织与个人发挥潜能而著称。",
      },
    ],
    historyHeading: "发展历程",
    historySubheading: "公司里程碑",
    history: [
      { year: "2016", description: "在吉隆坡成立，首个客服团队 12 人" },
      { year: "2018", description: "马尼拉运营中心启用" },
      { year: "2021", description: "伦敦技术中心成立" },
      { year: "2024", description: "员工突破 1,000 人" },
      { year: "2026", description: "服务覆盖 30 个国家与地区" },
    ],
  },
};
