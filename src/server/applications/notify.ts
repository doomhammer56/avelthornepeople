import "server-only";
import { sendMail } from "../mail/transport.ts";
import {
  rejectEmail,
  interviewEmail,
  offerEmail,
} from "../mail/applicationEmails.ts";
import type { StaffIdentity } from "../auth/identity.ts";
import { applicationDetails } from "./service.ts";
import type { stages } from "./contract.ts";

type Stage = (typeof stages)[number];
type InterviewDetails = {
  mode: "details" | "later";
  when?: string;
  location?: string;
  meetingLink?: string;
  note?: string;
};
type OfferDetails = { mode: "email" | "later"; note?: string };
export type NotifyResult = "sent" | "skipped" | "failed" | "none";

// Send the candidate-facing notification for a stage change, after the
// database write already committed. A failed send never undoes the stage
// change: the two are reported separately so staff can retry just the email.
// "skipped" means staff deliberately chose not to email (e.g. offer handled
// by phone) — that is not a failure and should not read like one in the UI.
export async function notifyStageChange(
  identity: StaffIdentity,
  applicationId: string,
  stage: Stage,
  interviewDetails?: InterviewDetails,
  offerDetails?: OfferDetails,
): Promise<NotifyResult> {
  if (stage === "OFFER" && offerDetails?.mode !== "email") return "skipped";
  if (stage !== "REJECTED" && stage !== "INTERVIEW" && stage !== "OFFER")
    return "none";
  const { application } = await applicationDetails(identity, applicationId);
  if (!application.email) return "skipped";
  const jobTitle =
    application.jobTitle?.[application.locale] ||
    application.jobTitle?.en ||
    application.jobTitle?.zh ||
    "";
  const email =
    stage === "REJECTED"
      ? rejectEmail(application.locale, application.name, jobTitle)
      : stage === "OFFER"
        ? offerEmail(
            application.locale,
            application.name,
            jobTitle,
            offerDetails?.note,
          )
        : interviewEmail(
            application.locale,
            application.name,
            jobTitle,
            interviewDetails ?? { mode: "later" },
          );
  await sendMail({ to: application.email, ...email });
  return "sent";
}
