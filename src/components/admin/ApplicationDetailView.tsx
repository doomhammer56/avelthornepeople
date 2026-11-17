"use client";

import { useRef, useState } from "react";
import { useAdminRouter as useRouter } from "./AdminNavigation";
import {
  recruitmentRequest,
  recruitmentContent,
} from "@/lib/admin/recruitmentClient";
import { stageLabels, type RecruitmentStage } from "@/lib/admin/recruitment";
import { AdminRequestError, signInAgain } from "@/lib/admin/staffClient";
import { useCvDownload } from "./useCvDownload";
import {
  InterviewInviteDialog,
  type InterviewDetails,
} from "./InterviewInviteDialog";
import { OfferDialog, type OfferDetails } from "./OfferDialog";
import { toast } from "sonner";
import {
  CircleAlert,
  Download,
  Eye,
  ShieldAlert,
  TriangleAlert,
  User,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyValue } from "./ui/empty-value";
import {
  applicationStatusTone,
  type ApplicationStatus,
} from "@/lib/admin/applicationStatus";
import { applicationsContent } from "@/lib/admin/applicationsContent";
import type { AdminApplication } from "@/lib/admin/adminApplications";
import type { AdminLang } from "@/lib/admin/nav";

type Props = {
  application: AdminApplication;
  jobTitle: string;
  lang: AdminLang;
  canEdit: boolean;
  onSaved?: () => void;
};

const stages: ApplicationStatus[] = [
  "New",
  "Screening",
  "Interview",
  "Offer",
  "Rejected",
];

// The candidate panel from the old inline split view, now the whole
// detail page instead of a sidebar next to the table.
export function ApplicationDetailView({
  application,
  jobTitle,
  lang,
  canEdit,
  onSaved,
}: Props) {
  const t = applicationsContent[lang];
  const [localStatus, setStatus] = useState(application.status);
  const [version, setVersion] = useState(application.version ?? 1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pendingCommand = useRef<{
      status: RecruitmentStage;
      expectedVersion: number;
      requestId: string;
      interviewDetails?: InterviewDetails;
      offerDetails?: OfferDetails;
    } | null>(null),
    inFlight = useRef(false);
  const router = useRouter(),
    r = recruitmentContent[lang];
  const status = canEdit ? localStatus : application.status;
  const { pending, download, preview } = useCvDownload(lang);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);

  // Rejected moves straight through. Interview and Offer collect details
  // first via their own dialog, which calls back into here with them attached.
  async function moveStage(
    stage: ApplicationStatus,
    interviewDetails?: InterviewDetails,
    offerDetails?: OfferDetails,
  ) {
    if (inFlight.current || !canEdit) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const code = Object.keys(stageLabels).find(
      (key) => stageLabels[key as RecruitmentStage] === stage,
    ) as RecruitmentStage;
    if (
      pendingCommand.current?.status !== code ||
      pendingCommand.current.expectedVersion !== version ||
      JSON.stringify(pendingCommand.current.interviewDetails) !==
        JSON.stringify(interviewDetails) ||
      JSON.stringify(pendingCommand.current.offerDetails) !==
        JSON.stringify(offerDetails)
    )
      pendingCommand.current = {
        status: code,
        expectedVersion: version,
        requestId: crypto.randomUUID(),
        interviewDetails,
        offerDetails,
      };
    try {
      const data = await recruitmentRequest<{
        result: { version: number; status: RecruitmentStage };
        notified: "sent" | "skipped" | "failed" | "none";
      }>(
        `/api/admin/applications/${application.id}`,
        "PATCH",
        pendingCommand.current,
      );
      setStatus(stageLabels[data.result.status]);
      setVersion(data.result.version);
      pendingCommand.current = null;
      setInterviewOpen(false);
      setOfferOpen(false);
      if (code === "REJECTED")
        toast[data.notified === "sent" ? "success" : "error"](
          data.notified === "sent" ? t.notifiedReject : t.notifyFailed,
        );
      else if (code === "INTERVIEW")
        toast[data.notified === "sent" ? "success" : "error"](
          data.notified === "sent" ? t.notifiedInterview : t.notifyFailed,
        );
      else if (code === "OFFER")
        toast[data.notified === "failed" ? "error" : "success"](
          data.notified === "sent"
            ? t.notifiedOffer
            : data.notified === "failed"
              ? t.notifyFailed
              : t.offerMarked,
        );
      else toast.success(r.saved);
      if (onSaved) onSaved();
      else router.refresh();
    } catch (cause) {
      if (cause instanceof AdminRequestError && cause.status === 401) {
        signInAgain(lang);
        return;
      }
      setError(r.failed);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const toneInfo = applicationStatusTone[status];

  return (
    <Card variant="panel" className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
        <Avatar className="size-10 bg-accent" aria-hidden="true">
          <AvatarFallback className="bg-accent text-sm font-bold text-primary">
            {application.name.slice(0, 1) || <User className="size-4" />}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <span className="block text-base font-semibold">
            {application.name ||
              `${lang === "zh" ? "投递" : "Application"} ${application.id.slice(0, 8)}`}
          </span>
          <span className="mt-0.5 block text-xs break-all text-muted-foreground">
            {application.candidateId} · {application.id}
          </span>
        </div>
        <Badge tone={toneInfo.tone}>{toneInfo.label[lang]}</Badge>
      </div>
      {application.duplicate ? (
        <Alert className="mx-5 mt-5 w-auto">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{t.duplicateNote}</AlertDescription>
        </Alert>
      ) : null}
      <dl className="m-0 grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
        {[
          [t.facts.job, jobTitle],
          [t.facts.email, application.email],
          [t.facts.phone, application.phone],
          [t.facts.source, t.sources[application.source]],
          [t.facts.submitted, application.submittedAt],
          [
            t.facts.consent,
            application.consentAt
              ? `${application.consentAt} · ${application.policyVersion}`
              : t.consentValue,
          ],
        ].map(([label, value]) => (
          <div className="flex min-w-0 flex-col gap-1" key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="m-0 text-sm break-words">
              {value || <EmptyValue />}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-3 border-t border-border p-5">
        {error ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <span className="text-[13px] font-medium text-foreground/80">
          {t.moveStatus}
        </span>
        <div className="flex flex-wrap gap-2">
          {stages.map((stage) => (
            <Button
              key={stage}
              variant={status === stage ? "default" : "outline"}
              disabled={!canEdit || busy || status === stage}
              onClick={() => {
                if (stage === "Interview") setInterviewOpen(true);
                else if (stage === "Offer") setOfferOpen(true);
                else moveStage(stage);
              }}
            >
              {applicationStatusTone[stage].label[lang]}
            </Button>
          ))}
        </div>
      </div>
      <InterviewInviteDialog
        lang={lang}
        open={interviewOpen}
        pending={busy}
        onOpenChange={setInterviewOpen}
        onSubmit={(details) => void moveStage("Interview", details)}
      />
      <OfferDialog
        lang={lang}
        open={offerOpen}
        pending={busy}
        onOpenChange={setOfferOpen}
        onSubmit={(details) => void moveStage("Offer", undefined, details)}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-border p-5">
        {application.cvUnscanned ? (
          <p className="m-0 mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="size-4" aria-hidden="true" />
            {lang === "zh"
              ? "此简历尚未进行恶意软件扫描。"
              : "This CV has not been scanned for malware."}
          </p>
        ) : null}
        <Button
          variant="outline"
          title={!application.cvAvailable ? t.actionsPending : undefined}
          disabled={!application.cvAvailable || pending}
          onClick={() => preview(application.id)}
        >
          <Eye aria-hidden="true" />
          {t.preview}
        </Button>
        <Button
          title={!application.cvAvailable ? t.actionsPending : undefined}
          disabled={!application.cvAvailable || pending}
          onClick={() => download(application.id)}
        >
          <Download aria-hidden="true" />
          {t.download}
        </Button>
      </div>
    </Card>
  );
}
