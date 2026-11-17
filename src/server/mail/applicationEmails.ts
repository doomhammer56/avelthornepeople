import "server-only";

type EmailLocale = "en" | "zh";
type Email = { subject: string; html: string; text: string };

const brand = "Avelthorne People Group";
const accent = "#55687a";

// Shared envelope for every transactional email: a plain white card with the
// brand name, a short intro, a body block, and a quiet closing line. Email
// clients need inline styles, so this stays outside the site's CSS entirely.
function layout(preheader: string, bodyHtml: string, closingHtml: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f3ef;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#33363d;">
    <span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3ef;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e5e4df;border-radius:8px;" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:28px 32px 0;">
                <span style="font-size:13px;font-weight:600;letter-spacing:0.04em;color:${accent};">${brand}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px;font-size:15px;line-height:1.7;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px;border-top:1px solid #efeeea;">
                <p style="font-size:13px;line-height:1.6;color:#7c808a;margin:16px 0 0;">${closingHtml}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const p = (text: string) => `<p style="margin:0 0 14px;">${text}</p>`;

// Candidate names come from the candidate's own profile, and venue/note
// fields come from staff free text: escape both before they reach HTML.
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// A meeting link is rendered as an href, so only accept http(s) URLs;
// anything else is dropped rather than interpolated into an attribute.
function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function rejectEmail(
  locale: EmailLocale,
  candidateName: string,
  jobTitle: string,
): Email {
  const rawName = candidateName || (locale === "zh" ? "您好" : "there");
  const name = escapeHtml(rawName);
  const title = escapeHtml(jobTitle);
  if (locale === "zh") {
    const body =
      p(`${name}，`) +
      p(`感谢您申请 ${brand} 的「${title}」职位，并抽出时间与我们分享您的背景信息。`) +
      p(
        `经过慎重考虑，我们决定推进其他候选人进入下一轮。此次竞争激烈，这一决定并不代表我们对您的能力或经验有任何负面评价。`,
      ) +
      p(`我们会保留您的资料，欢迎您未来关注并申请与您经验相匹配的职位。`) +
      p(`再次感谢您对 ${brand} 的关注。`);
    return {
      subject: `您的求职申请更新 — ${jobTitle}`,
      html: layout(`关于您申请「${title}」的最新进展`, body, `${brand} 招聘团队`),
      text: `${rawName}，\n\n感谢您申请 ${brand} 的「${jobTitle}」职位。经过慎重考虑，我们决定推进其他候选人进入下一轮，这并不代表对您能力或经验的否定评价。我们会保留您的资料，欢迎您未来申请合适的职位。\n\n${brand} 招聘团队`,
    };
  }
  const body =
    p(`Hi ${name},`) +
    p(
      `Thank you for applying for the <strong>${title}</strong> role at ${brand}, and for taking the time to share your background with us.`,
    ) +
    p(
      `After careful review, we've decided to move forward with other candidates for this position. It was a competitive process, and this decision doesn't reflect on your skills or experience.`,
    ) +
    p(
      `We'll keep your details on file and encourage you to apply for future roles that match your experience.`,
    ) +
    p(`Thank you again for your interest in ${brand}.`);
  return {
    subject: `Update on your application — ${jobTitle}`,
    html: layout(`An update on your ${title} application`, body, `${brand} Talent Team`),
    text: `Hi ${rawName},\n\nThank you for applying for the ${jobTitle} role at ${brand}. After careful review, we've decided to move forward with other candidates. This doesn't reflect on your skills or experience, and we encourage you to apply again in future.\n\n${brand} Talent Team`,
  };
}

export function interviewEmail(
  locale: EmailLocale,
  candidateName: string,
  jobTitle: string,
  details: {
    mode: "details" | "later";
    when?: string;
    location?: string;
    meetingLink?: string;
    note?: string;
  },
): Email {
  const rawName = candidateName || (locale === "zh" ? "您好" : "there");
  const name = escapeHtml(rawName);
  const title = escapeHtml(jobTitle);
  const link = details.meetingLink ? safeUrl(details.meetingLink) : "";
  const rows = [
    details.when
      ? [locale === "zh" ? "时间" : "When", escapeHtml(details.when)]
      : null,
    details.location
      ? [locale === "zh" ? "地点" : "Venue", escapeHtml(details.location)]
      : null,
    link
      ? [
          locale === "zh" ? "会议链接" : "Join link",
          `<a href="${link}" style="color:${accent};">${escapeHtml(link)}</a>`,
        ]
      : null,
  ].filter((row): row is [string, string] => row !== null);
  const note = details.note ? escapeHtml(details.note) : "";
  const detailsBox = rows.length
    ? `<table role="presentation" style="width:100%;margin:4px 0 18px;border:1px solid #e5e4df;border-radius:6px;">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:10px 14px;font-size:13px;color:#7c808a;white-space:nowrap;">${label}</td><td style="padding:10px 14px;font-size:14px;">${value}</td></tr>`,
          )
          .join("")}
      </table>`
    : "";
  if (locale === "zh") {
    const intro =
      details.mode === "details"
        ? p(`我们很高兴邀请您参加 ${brand}「${title}」职位的面试。`)
        : p(`恭喜！您已入围 ${brand}「${title}」职位的面试环节，我们会另行联系您确认具体时间、地点或会议链接。`);
    const body =
      p(`${name}，`) +
      intro +
      detailsBox +
      (note ? p(note) : "") +
      p(`如时间不便，请直接回复此邮件，我们会为您另行安排。`) +
      p(`期待与您交流。`);
    return {
      subject: `面试邀请 — ${brand}「${jobTitle}」`,
      html: layout(`您已获得「${title}」面试机会`, body, `${brand} 招聘团队`),
      text: `${rawName}，\n\n您已入围 ${brand}「${jobTitle}」职位的面试环节。${rows.map(([l, v]) => `${l}: ${v}`).join("; ")}${details.note ? `\n${details.note}` : ""}\n\n如时间不便，请回复此邮件。\n\n${brand} 招聘团队`,
    };
  }
  const intro =
    details.mode === "details"
      ? p(`Great news — we'd like to invite you to interview for the <strong>${title}</strong> role at ${brand}.`)
      : p(
          `Great news — you've been shortlisted for an interview for the <strong>${title}</strong> role at ${brand}. Our team will contact you separately with the exact time, venue or meeting link.`,
        );
  const body =
    p(`Hi ${name},`) +
    intro +
    detailsBox +
    (note ? p(note) : "") +
    p(`If this time doesn't work for you, just reply to this email and we'll find another slot.`) +
    p(`Looking forward to speaking with you.`);
  return {
    subject: `Interview invitation — ${jobTitle} at ${brand}`,
    html: layout(`You're invited to interview for ${title}`, body, `${brand} Talent Team`),
    text: `Hi ${rawName},\n\nYou've been shortlisted for an interview for the ${jobTitle} role at ${brand}. ${rows.map(([l, v]) => `${l}: ${v}`).join("; ")}${details.note ? `\n${details.note}` : ""}\n\nReply to this email if the time doesn't work.\n\n${brand} Talent Team`,
  };
}

export function offerEmail(
  locale: EmailLocale,
  candidateName: string,
  jobTitle: string,
  note?: string,
): Email {
  const rawName = candidateName || (locale === "zh" ? "您好" : "there");
  const name = escapeHtml(rawName);
  const title = escapeHtml(jobTitle);
  const safeNote = note ? escapeHtml(note) : "";
  if (locale === "zh") {
    const body =
      p(`${name}，`) +
      p(`恭喜您！我们很高兴通知您，${brand} 决定向您发出「${title}」职位的录用通知。`) +
      (safeNote ? p(safeNote) : "") +
      p(`我们的团队会尽快与您联系，确认薪资待遇、入职时间等具体细节。`) +
      p(`如有任何问题，请直接回复此邮件。`);
    return {
      subject: `录用通知 — ${brand}「${jobTitle}」`,
      html: layout(`您已获得「${title}」职位的录用通知`, body, `${brand} 招聘团队`),
      text: `${rawName}，\n\n恭喜！${brand} 决定向您发出「${jobTitle}」职位的录用通知。${note ? `\n${note}` : ""}\n\n我们的团队会尽快与您联系，确认具体细节。\n\n${brand} 招聘团队`,
    };
  }
  const body =
    p(`Hi ${name},`) +
    p(
      `Congratulations — we're delighted to offer you the <strong>${title}</strong> role at ${brand}.`,
    ) +
    (safeNote ? p(safeNote) : "") +
    p(`Our team will be in touch shortly to confirm compensation, start date and the remaining details.`) +
    p(`Reply to this email any time if you have questions in the meantime.`);
  return {
    subject: `Job offer — ${jobTitle} at ${brand}`,
    html: layout(`You've been offered the ${title} role`, body, `${brand} Talent Team`),
    text: `Hi ${rawName},\n\nCongratulations — we're delighted to offer you the ${jobTitle} role at ${brand}.${note ? `\n${note}` : ""}\n\nOur team will be in touch shortly to confirm the details.\n\n${brand} Talent Team`,
  };
}
