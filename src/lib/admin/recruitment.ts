export const stageLabels = {
  NEW: "New",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
} as const;
export type RecruitmentStage = keyof typeof stageLabels;
export type CandidateSummary = {
  id: string;
  version: number;
  name: string;
  email: string;
  phone: string;
  profileAvailable: boolean;
  available: boolean;
  mergeAllowed: boolean;
  applicationCount: number;
};
export type CandidateMatch = {
  candidate: CandidateSummary;
  reason: "both" | "email" | "phone";
  conflict: boolean;
};
export type MatchPage = {
  matches: CandidateMatch[];
  total: number;
  page: number;
  pageSize: number;
  reviewRequired: true;
};
