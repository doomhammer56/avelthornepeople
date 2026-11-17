import { z } from "zod";
export const stages = [
  "NEW",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
] as const;
const page = z.coerce.number().int().min(1).max(100000).default(1);
export const pagination = z.object({
  page,
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const base = {
  ...pagination.shape,
  jobId: z.uuid().optional(),
  candidateId: z.uuid().optional(),
  status: z
    .array(z.enum(stages))
    .max(5)
    .default([])
    .transform((values) => [...new Set(values)]),
  source: z
    .enum(["site", "linkedin", "jobstreet", "referral", "other"])
    .optional(),
  from: instant.optional(),
  to: instant.optional(),
};
function ordered(value: { from?: string; to?: string }) {
  return (
    !value.from || !value.to || Date.parse(value.from) < Date.parse(value.to)
  );
}
export const applicationQuery = z
  .object(base)
  .strict()
  .refine(ordered, { path: ["to"], message: "invalid_range" });
export const applicationSearch = z
  .object({
    ...base,
    email: z.string().trim().pipe(z.email().max(254)).optional(),
    phone: z.string().min(1).max(40).optional(),
    region: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  })
  .strict()
  .refine(ordered, { path: ["to"], message: "invalid_range" });
// Collected only when staff move an application to INTERVIEW, so the stage
// change and its invite email are submitted together as one command.
export const interviewDetails = z
  .object({
    mode: z.enum(["details", "later"]),
    when: z.string().trim().max(200).optional(),
    location: z.string().trim().max(200).optional(),
    meetingLink: z.string().trim().max(500).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
// Collected only when staff move an application to OFFER: either send the
// offer by email now, or just mark the stage because they'll contact the
// candidate separately (phone call, in person, etc).
export const offerDetails = z
  .object({
    mode: z.enum(["email", "later"]),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export const stageCommand = z
  .object({
    status: z.enum(stages),
    expectedVersion: z.number().int().positive(),
    requestId: z.uuid(),
    interviewDetails: interviewDetails.optional(),
    offerDetails: offerDetails.optional(),
  })
  .strict();
export const mergeCommand = z
  .object({
    sourceId: z.uuid(),
    sourceVersion: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
    requestId: z.uuid(),
  })
  .strict();
export function parseQuery(params: URLSearchParams) {
  const value: Record<string, unknown> = {};
  for (const key of new Set(params.keys())) {
    if (key === "lang") continue;
    const all = params.getAll(key);
    if (key !== "status" && all.length > 1) throw new Error("Invalid query");
    if (
      all.length === 1 &&
      all[0] === "" &&
      ["jobId", "source", "from", "to"].includes(key)
    )
      continue;
    value[key] = key === "status" ? all : all[0];
  }
  return applicationQuery.parse(value);
}
export type ApplicationQuery = z.infer<typeof applicationSearch>;
