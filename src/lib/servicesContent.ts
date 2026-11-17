import { homeContent, type Locale } from "./homeContent.ts";

export type ServiceItem = {
  title: string;
  description: string;
  points: readonly string[];
  photo: string;
  imageAlt: string;
};

export type ServicesContent = {
  eyebrow: string;
  title: string;
  services: ServiceItem[];
};

const capabilityPoints: Record<Locale, readonly (readonly string[])[]> = {
  en: [
    [
      "6 languages including English, Chinese, Malay, Tagalog",
      "Weekly reporting on response time and CSAT",
      "Scales with client volume",
    ],
    [
      "Standardised review procedures and rules",
      "PH DPA, MY PDPA, UK GDPR support",
      "Monthly risk reports",
    ],
    [
      "In-house ticketing, QA and rostering tools",
      "Real-time dashboards",
      "24/7 on-call",
    ],
  ],
  zh: [
    [
      "中、英、马来、他加禄等 6 种语言",
      "首响时长与满意度按周报告",
      "可按客户业务量弹性扩容",
    ],
    ["标准化审核流程与规则库", "支持 PH DPA、MY PDPA、UK GDPR", "月度风险报告"],
    ["工单、质检与排班系统自研", "实时数据看板", "7×24 线上值守"],
  ],
};

const servicePhotos = [
  "/photos/service-customer-operations-1280w.webp",
  "/photos/service-risk-compliance-1280w.webp",
  "/photos/service-technology-1280w.webp",
] as const;

const pageCopy: Record<
  Locale,
  { eyebrow: string; title: string; imageAlts: readonly string[] }
> = {
  en: {
    eyebrow: "Services",
    title: "Explore our areas of work.",
    imageAlts: [
      "Colleagues collaborating around a table on customer operations work.",
      "Team reviewing risk and compliance materials in the office.",
      "Technology specialists working together at screens.",
    ],
  },
  zh: {
    eyebrow: "业务领域",
    title: "了解我们的核心业务领域。",
    imageAlts: [
      "同事围坐协作，讨论客户运营工作。",
      "团队在办公室内审阅风控与合规材料。",
      "技术同事在屏幕前协作。",
    ],
  },
};

const serviceDescriptions: Record<Locale, readonly string[]> = {
  en: [
    "Supporting exceptional customer experiences through effective operations, service and delivery.",
    "Helping organisations manage risk, meet regulatory expectations and maintain high standards.",
    "Enabling business performance through technology, data and digital capability.",
  ],
  zh: [
    "通过高效的运营、服务与交付，支持卓越的客户体验。",
    "协助企业管理风险、满足监管要求并保持高标准。",
    "以技术、数据与数字化能力推动业务表现。",
  ],
};

function createContent(locale: Locale): ServicesContent {
  const home = homeContent[locale];
  const page = pageCopy[locale];
  return {
    eyebrow: page.eyebrow,
    title: page.title,
    services: home.services.map((service, index) => ({
      title: service.title,
      description: serviceDescriptions[locale][index] ?? service.description,
      points: capabilityPoints[locale][index] ?? [],
      photo: servicePhotos[index],
      imageAlt: page.imageAlts[index] ?? "",
    })),
  };
}

export const servicesContent: Record<Locale, ServicesContent> = {
  en: createContent("en"),
  zh: createContent("zh"),
};
