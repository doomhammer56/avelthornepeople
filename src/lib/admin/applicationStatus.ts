import type { AdminLang } from "./nav";

export type ApplicationStatus = "New" | "Screening" | "Interview" | "Offer" | "Rejected";

// Shared across the dashboard's recent list and the full Applications screen (A04),
// so a status always renders with the same label and tag color everywhere.
export const applicationStatusTone: Record<
  ApplicationStatus,
  { tone: "accent" | "amber" | "violet" | "accent-solid" | "gray"; label: Record<AdminLang, string> }
> = {
  New: { tone: "accent", label: { en: "New", zh: "新投递" } },
  Screening: { tone: "amber", label: { en: "Screening", zh: "筛选中" } },
  Interview: { tone: "violet", label: { en: "Interview", zh: "面试" } },
  Offer: { tone: "accent-solid", label: { en: "Offer", zh: "录用" } },
  Rejected: { tone: "gray", label: { en: "Rejected", zh: "未通过" } },
};
