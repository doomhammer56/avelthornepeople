import { z } from "zod";
import type { ApplicationContent } from "./applicationContent";
import type { Locale } from "./homeContent";
import { parsePhoneNumber } from "./phoneNumber.ts";
import {
  ApplicationSubmissionError,
  safeApplicationIssues,
} from "./applicationFeedback.ts";

// Match the storage service's decimal 10 MB limit before requesting a signed upload.
// Reject oversized files locally so candidates receive feedback before any network request.
export const maxResumeBytes = 10_000_000;
export type ApplicationEndpoints = { upload: string; applications: string };
export type ApplicationReceipt = {
  status: "accepted" | "duplicate";
  confirmationEmailSent: boolean;
};

// Validate the selected file and required contact details before requesting an upload.
// Browser checks improve feedback; the backend must independently verify files and consent.
export function createApplicationSchema(
  messages: Partial<ApplicationContent["validation"]> = {},
) {
  return z
    .object({
      name: z
        .string()
        .trim()
        .min(1, messages.nameRequired ?? messages.required)
        .max(120, messages.nameLength),
      email: z
        .string()
        .trim()
        .min(1, messages.emailRequired ?? messages.required)
        .pipe(z.email(messages.email).max(254, messages.email)),
      phone: z
        .string()
        .trim()
        .min(1, messages.phoneRequired ?? messages.required)
        .max(40, messages.phone),
      phoneCountry: z.string().optional(),
      resume: z.custom<File | null>().superRefine((file, context) => {
        if (!(typeof File !== "undefined" && file instanceof File)) {
          context.addIssue({
            code: "custom",
            message: messages.resumeRequired,
          });
          return;
        }
        if (file.size === 0)
          context.addIssue({ code: "custom", message: messages.resumeEmpty });
        if (file.name.length > 255)
          context.addIssue({ code: "custom", message: messages.resumeName });
        if (file.size > maxResumeBytes)
          context.addIssue({ code: "custom", message: messages.resumeSize });
        const extension = file.name.toLowerCase().split(".").pop();
        const expected =
          extension === "pdf"
            ? "application/pdf"
            : extension === "doc"
              ? "application/msword"
              : null;
        if (
          !expected ||
          (file.type &&
            file.type !== expected &&
            file.type !== "application/octet-stream")
        )
          context.addIssue({ code: "custom", message: messages.resumeType });
      }),
      coverLetter: z
        .string()
        .trim()
        .max(5000, messages.coverLetterLength)
        .optional(),
      consent: z.boolean().refine(Boolean, messages.consent),
    })
    .superRefine((value, context) => {
      if (value.phone && !parsePhoneNumber(value.phone, value.phoneCountry))
        context.addIssue({
          code: "custom",
          path: ["phone"],
          message: messages.phone,
        });
    });
}
export type ApplicationValues = z.infer<
  ReturnType<typeof createApplicationSchema>
>;

// Distinguish a confirmed closed role from transient delivery failures.
// The UI can stop retries without exposing upstream error bodies or candidate records.
export class ApplicationClosedError extends ApplicationSubmissionError {
  constructor() {
    super("closed");
  }
}

// Upload directly to a backend-issued signed destination before submitting metadata.
// Raw CV bytes never pass through a frontend route, storage layer, or application JSON body.
export async function submitApplication(
  endpoints: ApplicationEndpoints,
  jobId: string,
  locale: Locale,
  values: ApplicationValues,
  captchaToken: string,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<ApplicationReceipt> {
  // Revalidate at the transport boundary even when a caller bypasses the drawer.
  // No signing request may leave with unchecked contact details, files or consent.
  const validated = createApplicationSchema().parse(values);
  if (!validated.resume) throw new Error("Application validation required");
  const file = validated.resume;
  const contentType = file.name.toLowerCase().endsWith(".pdf")
    ? "application/pdf"
    : "application/msword";
  let stage: "upload" | "submit" = "upload";
  const timedOut = () =>
    signal.aborted && signal.reason?.name === "TimeoutError";
  const fetchApplication = async (url: string, options: RequestInit) => {
    try {
      return await fetch(url, options);
    } catch {
      throw new ApplicationSubmissionError(
        timedOut() ? "timeout" : stage === "upload" ? "upload" : "network",
      );
    }
  };
  const requestJson = async (url: string, body: unknown) => {
    const response = await fetchApplication(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify(body),
      signal,
    });
    if (response.status === 410) throw new ApplicationClosedError();
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const issues =
        response.status === 400 ? safeApplicationIssues(payload?.issues) : [];
      const retry = Number(response.headers.get("Retry-After"));
      const captchaFail =
        response.status === 400 &&
        payload &&
        typeof payload === "object" &&
        "code" in payload &&
        payload.code === "captcha_failed";
      throw new ApplicationSubmissionError(
        captchaFail
          ? "captcha"
          : issues.length
            ? "validation"
            : response.status === 429
              ? "rateLimited"
              : response.status === 403
                ? "forbidden"
                : response.status === 409
                  ? "conflict"
                  : response.status === 413
                    ? "validation"
                    : response.status >= 500
                      ? "unavailable"
                      : "invalidRequest",
        response.status === 413
          ? [{ field: "resume", code: "resume_size" }]
          : issues,
        retry > 0 && Number.isFinite(retry)
          ? Math.min(retry, 86400)
          : undefined,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new ApplicationSubmissionError(
        timedOut()
          ? "timeout"
          : stage === "submit"
            ? "unconfirmed"
            : "unavailable",
      );
    }
  };
  const grant = z
    .object({
      uploadUrl: z.url(),
      resumeToken: z.string().min(1),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .safeParse(
      await requestJson(endpoints.upload, {
        jobId,
        fileName: file.name,
        contentType,
        size: file.size,
      }),
    );
  if (!grant.success) throw new ApplicationSubmissionError("unavailable");
  const destination = new URL(grant.data.uploadUrl);
  if (
    destination.username ||
    destination.password ||
    (destination.protocol !== "https:" &&
      !(
        destination.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname)
      ))
  )
    throw new ApplicationSubmissionError("unavailable");
  const upload = await fetchApplication(grant.data.uploadUrl, {
    method: "PUT",
    credentials: "omit",
    body: file,
    headers: { "Content-Type": contentType, ...grant.data.headers },
    signal,
  });
  if (!upload.ok) throw new ApplicationSubmissionError("upload");
  stage = "submit";
  const acknowledgement = await requestJson(endpoints.applications, {
    jobId,
    locale,
    name: validated.name,
    email: validated.email,
    phone: parsePhoneNumber(
      validated.phone,
      validated.phoneCountry,
    )!.number.toString(),
    ...(validated.coverLetter ? { coverLetter: validated.coverLetter } : {}),
    resumeToken: grant.data.resumeToken,
    consent: true,
    consentVersion: "recruitment-24-months-v1",
    captchaToken,
  });
  const receipt = z
    .object({
      status: z.enum(["accepted", "duplicate"]),
      confirmationEmailSent: z.boolean(),
    })
    .safeParse(acknowledgement);
  if (!receipt.success) throw new ApplicationSubmissionError("unconfirmed");
  return receipt.data;
}
