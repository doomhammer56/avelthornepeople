import type { ApplicationStatus } from "./applicationStatus";
export type AdminApplication = {
  id: string;
  candidateId: string;
  name: string;
  jobId: string;
  email: string;
  phone: string;
  source: "site" | "linkedin" | "jobstreet" | "referral" | "other";
  profileAvailable?: boolean;
  cvAvailable?: boolean;
  cvUnscanned?: boolean;
  consentAt?: string;
  policyVersion?: string;
  status: ApplicationStatus;
  submittedAt: string;
  /** Backend flag for a possible existing candidate match. */
  duplicate: boolean;
  version?: number;
  jobTitle?: { en: string; zh: string };
  locale: "en" | "zh";
};
