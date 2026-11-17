import { homeJobs } from "./homeJobs";
import type { PublicJobDetail } from "./publicJobSchema";

// Preserve the reference's department-level descriptions as local design fixtures.
// Real per-role responsibilities and requirements must come from the detail API.
const descriptions = {
  "Customer Operations": {
    responsibilities: {
      en: [
        "Manage scheduling, QA and daily operations for a 20–30 person team",
        "Track response time, resolution rate and CSAT; review weekly",
        "Resolve escalations with Product and Risk",
      ],
      zh: [
        "负责 20–30 人客服团队的排班、质检与日常管理",
        "监控首响时长、解决率与客户满意度，按周复盘",
        "与产品、风控团队协作处理升级问题",
      ],
    },
    requirements: {
      en: [
        "3+ years in support or operations management",
        "Working proficiency in English and Chinese",
        "Familiar with ticketing systems and reporting",
      ],
      zh: [
        "3 年以上客服或运营管理经验",
        "中英文可作为工作语言",
        "熟悉工单系统与数据报表",
      ],
    },
  },
  "Risk & Compliance": {
    responsibilities: {
      en: [
        "Review transactions and accounts; flag anomalies",
        "Maintain risk rules and review procedures",
        "Support regulatory reporting",
      ],
      zh: [
        "审核交易与账户，识别异常行为",
        "维护风控规则与审核流程",
        "配合合规团队完成监管报送",
      ],
    },
    requirements: {
      en: [
        "1+ year in risk, review or compliance",
        "Proficient in Excel; SQL a plus",
        "Detail-oriented; open to shifts",
      ],
      zh: [
        "1 年以上风控、审核或合规经验",
        "熟练使用 Excel，了解 SQL 优先",
        "认真细致，可接受轮班",
      ],
    },
  },
  Technology: {
    responsibilities: {
      en: [
        "Design and maintain highly available services",
        "Take part in architecture and code reviews",
        "Keep production systems stable",
      ],
      zh: [
        "设计与维护高可用的后端服务",
        "参与架构评审与代码评审",
        "保障线上系统稳定运行",
      ],
    },
    requirements: {
      en: [
        "Strong CS fundamentals and system design",
        "Proficient in a mainstream backend language",
        "Experience with cloud platforms",
      ],
      zh: [
        "扎实的计算机基础与系统设计能力",
        "熟悉至少一门主流后端语言",
        "有云平台使用经验",
      ],
    },
  },
  "People & Admin": {
    responsibilities: {
      en: [
        "Run end-to-end hiring for operations roles",
        "Maintain the talent pool and channels",
        "Report hiring data weekly",
      ],
      zh: [
        "负责运营类岗位的全流程招聘",
        "维护人才库与招聘渠道",
        "输出每周招聘数据报告",
      ],
    },
    requirements: {
      en: [
        "1+ year in recruitment",
        "Strong communicator",
        "Fluent in English and Chinese",
      ],
      zh: ["1 年以上招聘经验", "沟通能力强，执行力好", "中英文沟通流利"],
    },
  },
};
// Retain the exact closing dates attached to the handoff's eight sample records.
// These belong to preview data and never override a live backend deadline.
const closingDates: Record<string, string> = {
  "1042": "2026-11-30",
  "1045": "2026-11-30",
  "1043": "2026-11-15",
  "1044": "2026-12-01",
  "1047": "2026-11-20",
  "1041": "2026-11-10",
  "1049": "2026-12-15",
  "1048": "2026-12-31",
};

// Join summaries to their handoff descriptions only in explicit preview mode.
// A live API failure must never substitute these sample responsibilities.
export const jobDetails: PublicJobDetail[] = homeJobs.map((job) => ({
  ...job,
  ...descriptions[job.department.en as keyof typeof descriptions],
  closesAt: closingDates[job.id],
  status: "open",
}));
