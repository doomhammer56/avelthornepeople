"use client";
import { useQuery } from "@tanstack/react-query";
import { applicationDetailOptions } from "@/lib/admin/queries";
import { AdminQueryFeedback } from "./AdminQueryFeedback";
import { Bone } from "./ui/data-skeleton";
import { AdminDataNotice } from "./AdminDataNotice";
import { AdminLink as Link } from "./AdminNavigation";
import { ApplicationDetailView } from "./ApplicationDetailView";
import { CandidateMatchReview } from "./CandidateMatchReview";
import { ArrowLeft, Briefcase, FileX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { AdminPageHeader } from "./ui/page-header";
import { EmptyState } from "./ui/empty-state";
import { SectionCard } from "./ui/section-card";
import { applicationsContent } from "@/lib/admin/applicationsContent";
import type { AdminLang } from "@/lib/admin/nav";

export function ApplicationDetailBoard({
  id,
  lang,
  back,
}: {
  id: string;
  lang: AdminLang;
  back: string;
}) {
  const details = useQuery(applicationDetailOptions(id));
  const t = applicationsContent[lang];
  if (
    details.error &&
    "status" in details.error &&
    details.error.status === 404
  )
    return (
      <EmptyState
        icon={FileX}
        title={
          lang === "en"
            ? "Application not found."
            : "\u672a\u627e\u5230\u6295\u9012\u8bb0\u5f55\u3002"
        }
        action={
          <Link href={back} className={buttonVariants({ variant: "outline" })}>
            {t.backToList}
          </Link>
        }
      />
    );
  if (!details.data) {
    if (details.isError)
      return (
        <AdminQueryFeedback
          lang={lang}
          error
          hasData={false}
          retry={() => void details.refetch()}
        />
      );
    // The id comes from the URL, so the back link and title are real already.
    return (
      <div className="flex min-w-0 flex-col gap-5">
        <AdminPageHeader
          above={
            <Link
              href={back}
              className={buttonVariants({
                variant: "ghost",
                size: "sm",
                className: "-ml-3 w-fit",
              })}
            >
              <ArrowLeft aria-hidden="true" />
              {t.backToList}
            </Link>
          }
          title={`${t.detailId} ${id}`}
          actions={<Bone width={120} height={36} />}
        />
        <div
          role="status"
          aria-busy="true"
          className="mx-auto flex w-full max-w-3xl flex-col gap-5"
        >
          <span className="sr-only">
            {lang === "zh" ? "正在加载…" : "Loading…"}
          </span>
          {[0, 1, 2].map((card) => (
            <SectionCard key={card} aria-hidden="true">
              <div className="flex flex-col gap-3">
                <Bone
                  width={card === 0 ? "45%" : 160}
                  height={card === 0 ? 20 : 16}
                />
                <Bone width="65%" height={12} />
                <Bone height={12} />
                <Bone width="80%" height={12} />
              </div>
            </SectionCard>
          ))}
        </div>
      </div>
    );
  }
  const { application, candidate, submittedProfile, coverLetter } =
    details.data;
  const jobTitle =
    application.jobTitle[lang] || application.jobTitle.zh || application.jobId;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <AdminQueryFeedback
        lang={lang}
        error={details.isError}
        retry={() => void details.refetch()}
      />
      <AdminPageHeader
        above={
          <Link
            href={back}
            className={buttonVariants({
              variant: "ghost",
              size: "sm",
              className: "-ml-3 w-fit",
            })}
          >
            <ArrowLeft aria-hidden="true" />
            {t.backToList}
          </Link>
        }
        title={`${t.detailId} ${application.id}`}
        actions={
          application.jobId ? (
            <Link
              href={`/admin/jobs/${application.jobId}/edit?lang=${lang}`}
              className={buttonVariants({ variant: "outline" })}
            >
              <Briefcase aria-hidden="true" />
              {t.backToJob}
            </Link>
          ) : null
        }
      />
      {application.profileAvailable === false && (
        <AdminDataNotice lang={lang} kind="profilePending" />
      )}
      <ApplicationDetailView
        application={application}
        jobTitle={jobTitle}
        lang={lang}
        key={`${application.id}:${application.version}`}
        canEdit={candidate?.available === true}
        onSaved={() => void details.refetch()}
      />
      {submittedProfile ? (
        <SectionCard
          className="mx-auto w-full max-w-3xl"
          title={lang === "zh" ? "提交时的资料" : "Submitted profile"}
        >
          <div className="flex flex-col gap-1 text-sm">
            <p className="m-0">{submittedProfile.name}</p>
            <p className="m-0 text-muted-foreground">
              {submittedProfile.email}
            </p>
            <p className="m-0 text-muted-foreground">
              {submittedProfile.phone}
            </p>
          </div>
        </SectionCard>
      ) : null}
      {coverLetter ? (
        <SectionCard
          className="mx-auto w-full max-w-3xl"
          title={lang === "zh" ? "求职信" : "Cover letter"}
        >
          <p className="m-0 text-sm leading-relaxed whitespace-pre-wrap">
            {coverLetter}
          </p>
        </SectionCard>
      ) : null}
      {candidate ? (
        <CandidateMatchReview
          key={`${candidate.id}:${candidate.version}`}
          onSaved={() => void details.refetch()}
          candidate={candidate}
          applicationId={application.id}
          lang={lang}
        />
      ) : null}
    </div>
  );
}
