import { z } from "zod";
import { parsePhoneNumber } from "../../lib/phoneNumber.ts";

export const uploadRequest = z
  .object({
    jobId: z.uuid(),
    fileName: z.string().min(1).max(255),
    contentType: z.enum(["application/pdf", "application/msword"]),
    size: z.number().int().min(1).max(10_000_000),
  })
  .strict()
  .refine(
    (v) =>
      v.fileName
        .toLowerCase()
        .endsWith(v.contentType === "application/pdf" ? ".pdf" : ".doc"),
    { path: ["fileName"] },
  );

export const intakeRequest = z
  .object({
    jobId: z.uuid(),
    locale: z.enum(["en", "zh"]),
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().pipe(z.email().max(254)),
    phone: z
      .string()
      .trim()
      .max(40)
      .refine((value) => !!parsePhoneNumber(value)),
    coverLetter: z.string().trim().max(5000).optional(),
    resumeToken: z.string().regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/),
    consent: z.literal(true),
    consentVersion: z.literal("recruitment-24-months-v1"),
    captchaToken: z.string().min(1).max(4096),
  })
  .strict();
