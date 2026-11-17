// Maintained starting vacancies for Tricore Customer Care LLC's three existing office cities.
// Stable slugs identify seed records; database IDs are allocated on insertion.
export const departments = [
  { code: "CUSTOMER_OPERATIONS", en: "Customer Operations", zh: "客户运营" },
  { code: "RISK_COMPLIANCE", en: "Risk & Compliance", zh: "风控与合规" },
  { code: "TECHNOLOGY", en: "Technology", zh: "技术服务" },
  { code: "PEOPLE_CULTURE", en: "People & Culture", zh: "人力资源" },
  { code: "FINANCE_OPERATIONS", en: "Finance Operations", zh: "财务运营" },
];
export const locations = [
  {
    code: "KUALA_LUMPUR",
    en: "Kuala Lumpur",
    zh: "吉隆坡",
    country: "MY",
    timeZone: "Asia/Kuala_Lumpur",
  },
  {
    code: "MANILA",
    en: "Manila",
    zh: "马尼拉",
    country: "PH",
    timeZone: "Asia/Manila",
  },
  {
    code: "LONDON",
    en: "London",
    zh: "伦敦",
    country: "GB",
    timeZone: "Europe/London",
  },
];
export const vacancies = [
  {
    slug: "mandarin-customer-support-specialist-kuala-lumpur",
    department: "CUSTOMER_OPERATIONS",
    location: "KUALA_LUMPUR",
    experience: "ENTRY",
    salary: [4500, 6500, "MYR", "MONTH"],
    closingDays: 45,
    en: {
      title: "Customer Support Specialist — Mandarin & English",
      responsibilities: [
        "Resolve customer enquiries through live chat and email, recording accurate case notes and agreed next steps.",
        "Investigate account and payment issues with the operations team and escalate sensitive cases through approved channels.",
        "Contribute to knowledge-base updates and meet agreed service-quality and response-time targets across rotating shifts.",
      ],
      requirements: [
        "Professional written and spoken Mandarin and English, with a clear and empathetic communication style.",
        "Experience in customer service or a customer-facing role; motivated graduates with strong communication skills are welcome.",
        "Confidence using ticketing systems and spreadsheets, and availability for scheduled weekend or evening shifts in Kuala Lumpur.",
      ],
    },
    zh: {
      title: "客户支持专员（普通话及英语）",
      responsibilities: [
        "通过在线聊天及邮件处理客户咨询，准确记录问题、处理过程及后续安排。",
        "与运营团队调查账户及支付问题，并按规定流程升级敏感个案。",
        "参与知识库维护，在轮班安排下达成服务质量及响应时效目标。",
      ],
      requirements: [
        "具备专业的普通话及英语书面和口头沟通能力，表达清晰并理解客户需求。",
        "有客户服务或面向客户的工作经验；欢迎沟通能力出色的应届毕业生申请。",
        "熟悉工单系统及电子表格，能够在吉隆坡按排班安排参与晚间或周末工作。",
      ],
    },
  },
  {
    slug: "customer-operations-team-lead-manila",
    department: "CUSTOMER_OPERATIONS",
    location: "MANILA",
    experience: "MID",
    salary: [65000, 90000, "PHP", "MONTH"],
    closingDays: 45,
    en: {
      title: "Customer Operations Team Lead",
      responsibilities: [
        "Lead daily delivery for a team of customer support specialists, balancing queue coverage, service levels and case quality.",
        "Run coaching sessions, review quality assessments and turn recurring customer issues into practical process improvements.",
        "Coordinate escalations and shift handovers with workforce planning, risk and client account teams.",
      ],
      requirements: [
        "At least three years in customer operations, including one year coaching or supervising a support team.",
        "Strong English communication and practical experience with service-level reporting, quality assurance and incident escalation.",
        "Ability to lead an office-based team in Manila and support a rotating operations schedule.",
      ],
    },
    zh: {
      title: "客户运营组长",
      responsibilities: [
        "带领客户支持团队开展日常工作，协调排班覆盖、服务时效及个案处理质量。",
        "开展员工辅导及质量复盘，将重复出现的客户问题转化为可执行的流程改进。",
        "与人力排班、风控及客户管理团队协调升级个案和交接班安排。",
      ],
      requirements: [
        "至少三年客户运营经验，其中至少一年团队辅导或管理经验。",
        "英语沟通流畅，熟悉服务指标报告、质量管理及事件升级流程。",
        "能够在马尼拉办公室带领团队，并配合运营轮班安排。",
      ],
    },
  },
  {
    slug: "kyc-operations-analyst-kuala-lumpur",
    department: "RISK_COMPLIANCE",
    location: "KUALA_LUMPUR",
    experience: "MID",
    salary: [5500, 8000, "MYR", "MONTH"],
    closingDays: 60,
    en: {
      title: "KYC Operations Analyst",
      responsibilities: [
        "Review customer identification and onboarding documents against approved client policies and record evidence for each decision.",
        "Investigate document inconsistencies, complete enhanced review checklists and escalate cases outside delegated authority.",
        "Maintain accurate review queues and work with quality assurance to improve decision consistency and turnaround times.",
      ],
      requirements: [
        "Two or more years of experience in identity verification, onboarding operations or compliance support.",
        "Careful document analysis, strong written English and the ability to explain decisions without exposing sensitive customer information.",
        "Comfort working with case-management tools, defined review procedures and changing client requirements.",
      ],
    },
    zh: {
      title: "客户身份核验运营分析师",
      responsibilities: [
        "依据经批准的客户政策审核身份及开户材料，并为每项审核结论记录证据。",
        "调查材料中的不一致信息，完成加强审核清单，并升级超出授权范围的个案。",
        "维护准确的审核队列，与质量团队合作提升判断一致性和处理效率。",
      ],
      requirements: [
        "具备两年或以上身份核验、客户准入运营或合规支持经验。",
        "材料分析细致，英语书面表达良好，能够在保护客户敏感信息的前提下说明审核结论。",
        "熟悉个案管理工具，能够遵循审核程序并适应客户要求的变化。",
      ],
    },
  },
  {
    slug: "fraud-risk-analyst-manila",
    department: "RISK_COMPLIANCE",
    location: "MANILA",
    experience: "MID",
    salary: [55000, 80000, "PHP", "MONTH"],
    closingDays: 45,
    en: {
      title: "Fraud Risk Analyst",
      responsibilities: [
        "Assess transaction and account alerts, document investigation findings and recommend action within approved operating procedures.",
        "Identify recurring fraud patterns and partner with operations and data teams to improve alert quality.",
        "Prepare concise handover reports and escalate urgent cases while maintaining a clear and auditable decision trail.",
      ],
      requirements: [
        "At least two years in fraud operations, payment review or risk investigations.",
        "Strong spreadsheet skills and experience evaluating transaction patterns; SQL knowledge is an advantage.",
        "Sound judgement, clear written English and availability for scheduled shifts at the Manila operations centre.",
      ],
    },
    zh: {
      title: "反欺诈风控分析师",
      responsibilities: [
        "评估交易及账户预警，记录调查结果，并在批准的操作流程内提出处理建议。",
        "识别重复出现的欺诈模式，与运营及数据团队共同提升预警质量。",
        "编写简明交接报告并升级紧急个案，确保处理决策具备清晰的审计记录。",
      ],
      requirements: [
        "至少两年反欺诈运营、支付审核或风险调查经验。",
        "熟练使用电子表格并具备交易模式分析经验；掌握 SQL 者优先。",
        "判断稳健，英语书面表达清晰，能够配合马尼拉运营中心的排班安排。",
      ],
    },
  },
  {
    slug: "compliance-operations-manager-london",
    department: "RISK_COMPLIANCE",
    location: "LONDON",
    experience: "SENIOR",
    salary: [65000, 85000, "GBP", "YEAR"],
    closingDays: 60,
    en: {
      title: "Compliance Operations Manager",
      responsibilities: [
        "Own the operational control framework for client review programmes, including procedures, quality checks and issue remediation.",
        "Translate approved compliance requirements into clear workflows and coordinate delivery across the London, Kuala Lumpur and Manila teams.",
        "Lead control reviews, maintain evidence for client assurance requests and report material risks to senior management.",
      ],
      requirements: [
        "Five or more years in compliance or risk operations, including responsibility for team delivery and operational controls.",
        "Experience managing customer due-diligence workflows, assurance reviews and cross-functional remediation plans.",
        "Strong stakeholder communication and the ability to lead distributed teams from the London office.",
      ],
    },
    zh: {
      title: "合规运营经理",
      responsibilities: [
        "负责客户审核项目的运营控制体系，包括操作程序、质量检查及问题整改。",
        "将经批准的合规要求转化为清晰的工作流程，协调伦敦、吉隆坡及马尼拉团队的交付。",
        "组织控制评估，维护客户审查所需证据，并向管理层汇报重大风险。",
      ],
      requirements: [
        "至少五年合规或风控运营经验，并具备团队交付及运营控制管理经历。",
        "具备客户尽职调查流程、质量审查及跨部门整改计划的管理经验。",
        "利益相关方沟通能力出色，能够以伦敦办公室为基地管理跨地区团队。",
      ],
    },
  },
  {
    slug: "full-stack-software-engineer-kuala-lumpur",
    department: "TECHNOLOGY",
    location: "KUALA_LUMPUR",
    experience: "MID",
    salary: [9000, 14000, "MYR", "MONTH"],
    closingDays: 60,
    en: {
      title: "Full-Stack Software Engineer",
      responsibilities: [
        "Build and maintain internal operations applications, delivering accessible interfaces and reliable backend APIs.",
        "Work with product and operations colleagues to clarify requirements, review code and release small, well-tested improvements.",
        "Improve application performance, observability and data access controls, and support production incident investigation.",
      ],
      requirements: [
        "Three or more years building production web applications with TypeScript, React and a server-side JavaScript framework.",
        "Practical PostgreSQL knowledge and experience designing authenticated APIs, automated tests and deployment pipelines.",
        "Clear communication, collaborative code-review habits and willingness to work with the Kuala Lumpur engineering team.",
      ],
    },
    zh: {
      title: "全栈软件工程师",
      responsibilities: [
        "开发和维护内部运营应用，交付易用的用户界面及可靠的后端 API。",
        "与产品及运营同事明确需求、开展代码评审，并持续发布经过测试的小幅改进。",
        "优化应用性能、可观测性及数据访问控制，支持生产事件调查。",
      ],
      requirements: [
        "至少三年生产级 Web 应用开发经验，熟悉 TypeScript、React 及服务端 JavaScript 框架。",
        "具备 PostgreSQL 实践经验，熟悉身份验证 API、自动化测试及部署流水线。",
        "沟通清晰，重视协作式代码评审，能够与吉隆坡工程团队共同工作。",
      ],
    },
  },
  {
    slug: "operations-data-analyst-manila",
    department: "TECHNOLOGY",
    location: "MANILA",
    experience: "MID",
    jobType: "CONTRACT",
    salary: [60000, 85000, "PHP", "MONTH"],
    closingDays: 30,
    en: {
      title: "Operations Data Analyst — 12-Month Contract",
      responsibilities: [
        "Build and maintain service-performance dashboards covering customer operations, review queues and workforce capacity.",
        "Investigate changes in operational metrics and explain findings through clear reports and practical recommendations.",
        "Partner with data engineering and business teams to document metric definitions and improve source-data quality.",
      ],
      requirements: [
        "Two or more years in data analysis, business intelligence or operations reporting.",
        "Strong SQL and spreadsheet skills, plus hands-on experience with a business-intelligence tool such as Power BI or Tableau.",
        "Ability to communicate analysis to non-technical colleagues and commit to a 12-month position in Manila.",
      ],
    },
    zh: {
      title: "运营数据分析师（十二个月合同）",
      responsibilities: [
        "建立并维护客户运营、审核队列及人员产能相关的服务绩效看板。",
        "调查运营指标变化，通过清晰报告及可执行建议解释分析结果。",
        "与数据工程及业务团队共同维护指标定义，提升源数据质量。",
      ],
      requirements: [
        "至少两年数据分析、商业智能或运营报表经验。",
        "熟练使用 SQL 及电子表格，并具备 Power BI、Tableau 等商业智能工具的实践经验。",
        "能够向非技术同事清晰解释分析结果，并可在马尼拉完成十二个月的合同工作。",
      ],
    },
  },
  {
    slug: "site-reliability-engineer-london",
    department: "TECHNOLOGY",
    location: "LONDON",
    experience: "SENIOR",
    salary: [70000, 95000, "GBP", "YEAR"],
    closingDays: 60,
    en: {
      title: "Site Reliability Engineer",
      responsibilities: [
        "Maintain reliable cloud infrastructure and deployment pipelines for operations platforms used across multiple regions.",
        "Improve monitoring, alerting and recovery procedures, and lead blameless reviews following service incidents.",
        "Work with engineering teams on capacity planning, security updates and repeatable infrastructure changes.",
      ],
      requirements: [
        "Four or more years in platform engineering, site reliability or production infrastructure operations.",
        "Hands-on experience with AWS, Linux, infrastructure as code and monitoring systems; PostgreSQL operations experience is valuable.",
        "Strong incident-response judgement and willingness to join an agreed on-call rota with the London technology team.",
      ],
    },
    zh: {
      title: "站点可靠性工程师",
      responsibilities: [
        "维护跨地区运营平台所需的云基础设施及部署流水线，保障服务可靠运行。",
        "优化监控、告警及恢复流程，并在服务事件后组织无责复盘。",
        "与工程团队开展容量规划、安全更新及可重复执行的基础设施变更。",
      ],
      requirements: [
        "至少四年平台工程、站点可靠性或生产基础设施运营经验。",
        "具备 AWS、Linux、基础设施即代码及监控系统实践经验；有 PostgreSQL 运维经验者优先。",
        "具备良好的事件响应判断力，愿意参加伦敦技术团队约定的值班轮换。",
      ],
    },
  },
  {
    slug: "talent-acquisition-specialist-kuala-lumpur",
    department: "PEOPLE_CULTURE",
    location: "KUALA_LUMPUR",
    experience: "MID",
    salary: [6000, 8500, "MYR", "MONTH"],
    closingDays: 45,
    en: {
      title: "Talent Acquisition Specialist",
      responsibilities: [
        "Manage recruitment for operations and technology roles, from hiring-manager briefing through offer coordination.",
        "Build relevant candidate pipelines, coordinate structured interviews and maintain timely, respectful candidate communication.",
        "Keep applicant records accurate and use hiring data to improve sourcing effectiveness and candidate experience.",
      ],
      requirements: [
        "Two or more years in end-to-end recruitment, ideally supporting customer operations or technology hiring.",
        "Strong interviewing, scheduling and stakeholder-management skills, with professional English communication.",
        "Experience with applicant-tracking systems and a careful approach to candidate privacy and record keeping.",
      ],
    },
    zh: {
      title: "人才招聘专员",
      responsibilities: [
        "负责运营及技术职位的招聘全流程，包括需求沟通、面试协调及录用安排。",
        "建立相关人才渠道，协调结构化面试，并与候选人保持及时、尊重的沟通。",
        "准确维护应聘记录，利用招聘数据提升渠道效果及候选人体验。",
      ],
      requirements: [
        "至少两年全流程招聘经验，有客户运营或技术岗位招聘经历者优先。",
        "面试、日程协调及利益相关方管理能力良好，具备专业英语沟通能力。",
        "熟悉招聘管理系统，重视候选人隐私及记录管理。",
      ],
    },
  },
  {
    slug: "finance-operations-associate-manila",
    department: "FINANCE_OPERATIONS",
    location: "MANILA",
    experience: "ENTRY",
    salary: [40000, 60000, "PHP", "MONTH"],
    closingDays: 45,
    en: {
      title: "Finance Operations Associate",
      responsibilities: [
        "Prepare supplier payment schedules, reconcile transaction records and investigate differences with the relevant teams.",
        "Maintain supporting documents for invoices and expenses, and assist with accurate month-end reporting.",
        "Follow approval controls and help improve recurring finance processes without compromising record accuracy.",
      ],
      requirements: [
        "A qualification in accounting, finance or a related discipline, or equivalent practical experience.",
        "Strong spreadsheet skills and attention to detail; one year of bookkeeping or finance operations experience is an advantage.",
        "Clear English communication and the ability to manage confidential records and recurring deadlines in the Manila office.",
      ],
    },
    zh: {
      title: "财务运营助理",
      responsibilities: [
        "编制供应商付款计划，核对交易记录，并与相关团队调查差异。",
        "维护发票及费用支持文件，协助完成准确的月末报表。",
        "遵守审批控制要求，在确保记录准确的前提下改进日常财务流程。",
      ],
      requirements: [
        "具备会计、财务或相关专业学历，或同等实际工作经验。",
        "电子表格技能良好且注重细节；有一年记账或财务运营经验者优先。",
        "英语沟通清晰，能够在马尼拉办公室妥善处理保密资料并按期完成周期性工作。",
      ],
    },
  },
];
