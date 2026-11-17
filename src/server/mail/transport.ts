import "server-only";
import nodemailer from "nodemailer";

let transporter: ReturnType<typeof nodemailer.createTransport> | undefined;

// Reuse one pooled SMTP connection across requests instead of reconnecting
// per send, matching the existing database pool pattern in this codebase.
function mailTransport() {
  const host = process.env.SMTP_HOST,
    user = process.env.SMTP_USER,
    pass = process.env.SMTP_PASS;
  if (!host || !user || !pass)
    throw new Error("Email delivery is not configured");
  transporter ??= nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user, pass },
  });
  return transporter;
}

/** True when SMTP credentials are present, so app-sent mail can be attempted. */
export function mailConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

export async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  await mailTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });
}
