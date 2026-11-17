import type { ApplicationPage } from "../../server/applications/service.ts";
import type { AdminLang } from "./nav.ts";
import { applicationsContent } from "./applicationsContent.ts";
import { applicationStatusTone } from "./applicationStatus.ts";
import type { ExportReport } from "./exportReport.ts";

// Present the same authorized application page in a full workbook and readable PDF table.
// Full technical IDs remain in Excel; the PDF keeps each application's full reference under its name.
export function applicationExport(
  applications: ApplicationPage["applications"],
  lang: AdminLang,
  timeZone: string,
  summary: string[],
) {
  const t = applicationsContent[lang];
  const dates = new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone,
  });
  const values = applications.map((app) => ({
    app,
    name: app.name || `${t.detailId} ${app.id.slice(0, 8)}`,
    job: app.jobTitle[lang] || app.jobTitle.zh || app.jobId,
    submitted: Number.isFinite(Date.parse(app.submittedAt))
      ? dates.format(new Date(app.submittedAt))
      : "—",
    stage: applicationStatusTone[app.status].label[lang],
  }));
  const headers = [
    t.applicationId,
    t.columns.candidate,
    t.candidateId,
    t.columns.job,
    t.facts.email,
    t.facts.phone,
    t.columns.source,
    t.columns.submitted,
    t.columns.status,
  ];
  const rows = values.map(({ app, name, job, submitted, stage }) => [
    app.id,
    name,
    app.candidateId,
    job,
    app.email,
    app.phone,
    t.sources[app.source],
    `${submitted}\n${app.submittedAt}`,
    stage,
  ]);
  const report: ExportReport = {
    locale: lang,
    timeZone,
    summary,
    pdf: {
      headers: [
        t.columns.candidate,
        t.columns.job,
        t.contact,
        t.columns.source,
        t.columns.submitted,
        t.columns.status,
      ],
      rows: values.map(({ app, name, job, submitted, stage }) => [
        `${name}\n${app.id}`,
        job,
        [app.email, app.phone].filter(Boolean).join("\n"),
        t.sources[app.source],
        submitted,
        stage,
      ]),
      widths: [64, 51, 60, 25, 43, 26],
    },
  };
  return { headers, rows, report };
}
