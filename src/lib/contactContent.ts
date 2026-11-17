import type { Locale } from "./homeContent";

export type ContactEnquiry = {
  label: string;
  description: string;
};

export type ContactContent = {
  eyebrow: string;
  title: string;
  introduction: string;
  enquiries: ContactEnquiry[];
  viewJobs: string;
  name: string;
  company: string;
  email: string;
  message: string;
  send: string;
  sending: string;
  successTitle: string;
  successDescription: string;
  failed: string;
  noScript: string;
  validation: {
    required: string;
    email: string;
    nameLength: string;
    companyLength: string;
    messageLength: string;
  };
};

export const contactContent: Record<Locale, ContactContent> = {
  en: {
    eyebrow: "Contact",
    title: "Get In Touch",
    introduction: "Connect with Tricore Customer Care LLC.",
    enquiries: [
      {
        label: "Business Enquiries",
        description: "Discuss our services and business enquiries.",
      },
      {
        label: "Careers Enquiries",
        description: "Explore opportunities across our teams.",
      },
    ],
    viewJobs: "View Jobs",
    name: "Full Name",
    company: "Company",
    email: "Email",
    message: "Message",
    send: "Send",
    sending: "Sending…",
    successTitle: "Message Received",
    successDescription: "Thanks — our team will get back to you soon.",
    failed:
      "Your message could not be confirmed. Please try again in a moment.",
    noScript: "Enable JavaScript to use this form.",
    validation: {
      required: "Please complete this field.",
      email: "Enter a valid email address.",
      nameLength: "Use 120 characters or fewer.",
      companyLength: "Use 160 characters or fewer.",
      messageLength: "Use 5,000 characters or fewer.",
    },
  },
  zh: {
    eyebrow: "联系我们",
    title: "取得联系",
    introduction: "欢迎与 Tricore Customer Care LLC 取得联系。",
    enquiries: [
      {
        label: "业务咨询",
        description: "讨论我们的服务与业务合作相关事宜。",
      },
      {
        label: "招聘咨询",
        description: "了解我们各团队的工作机会。",
      },
    ],
    viewJobs: "查看职位",
    name: "姓名",
    company: "公司",
    email: "邮箱",
    message: "留言内容",
    send: "发送",
    sending: "正在发送…",
    successTitle: "已收到你的留言",
    successDescription: "感谢留言，我们会尽快回复。",
    failed: "暂时无法确认留言是否已收到，请稍后重试。",
    noScript: "请启用 JavaScript 以使用此表单。",
    validation: {
      required: "请填写此项。",
      email: "请输入有效的邮箱地址。",
      nameLength: "请输入不超过 120 个字符。",
      companyLength: "请输入不超过 160 个字符。",
      messageLength: "请输入不超过 5,000 个字符。",
    },
  },
};
