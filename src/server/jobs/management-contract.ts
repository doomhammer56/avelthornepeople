import { z } from "zod";
import {
  genderOptions,
  priorityOptions,
  recruitingTextLimit,
} from "../../lib/admin/jobImport/columns.ts";

export {
  jobStatuses,
  parseJobQuery,
  type JobListQuery,
} from "../../lib/admin/jobListQuery.ts";

// Bound raw arrays/strings first: blank input cannot bypass the size limits.
const lines = z
  .array(
    z
      .string()
      .max(2000)
      .transform((v) => v.trim()),
  )
  .max(50)
  .transform((v) => v.filter(Boolean));
const language = z.strictObject({
  title: z
    .string()
    .max(200)
    .transform((v) => v.trim()),
  responsibilities: lines,
  requirements: lines,
});
const instant = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
const salary = z
  .strictObject({
    min: z.number().finite().min(0).max(999999999999.99).multipleOf(0.01),
    max: z.number().finite().min(0).max(999999999999.99).multipleOf(0.01),
    currency: z.string().regex(/^[A-Z]{3}$/),
    period: z.enum(["HOUR", "DAY", "MONTH", "YEAR"]),
  })
  .refine((v) => v.min <= v.max, { path: ["max"], message: "invalid_range" });
// Staff-only recruiting details (never part of the public job DTO). Every field
// is optional so existing drafts stay valid; empty values are dropped by the
// database, which stores the canonical sparse form.
const noteText = z
  .string()
  .max(recruitingTextLimit)
  .transform((v) => v.trim());
const note = z.strictObject({
  en: noteText.optional(),
  zh: noteText.optional(),
});
export const jobRecruitingSchema = z.strictObject({
  priority: z
    .enum(priorityOptions.map((o) => o.code) as [string, ...string[]])
    .nullable()
    .optional(),
  gender: z
    .enum(genderOptions.map((o) => o.code) as [string, ...string[]])
    .nullable()
    .optional(),
  nationality: note.optional(),
  age: note.optional(),
  languages: note.optional(),
  workingHours: note.optional(),
  salaryNote: note.optional(),
  workArrangement: note.optional(),
  other: note.optional(),
  benefits: note.optional(),
  precautions: note.optional(),
  hardRequirements: note.optional(),
  remark: note.optional(),
});
export type JobRecruiting = z.infer<typeof jobRecruitingSchema>;
export const jobDraftSchema = z.strictObject({
  en: language,
  zh: language,
  recruiting: jobRecruitingSchema.optional(),
  settings: z
    .strictObject({
      departmentId: z.uuid().nullable(),
      locationIds: z
        .array(z.uuid())
        .max(30)
        .refine((v) => new Set(v).size === v.length),
      jobType: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
      experience: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
      salary: salary.nullable(),
      showSalary: z.boolean(),
      publishAt: instant.nullable(),
      closeAt: instant.nullable(),
    })
    .refine((v) => !v.showSalary || v.salary !== null, {
      path: ["salary"],
      message: "required",
    })
    .refine(
      (v) =>
        !v.publishAt ||
        !v.closeAt ||
        Date.parse(v.closeAt) > Date.parse(v.publishAt),
      { path: ["closeAt"], message: "invalid_range" },
    ),
});
export type JobDraft = z.infer<typeof jobDraftSchema>;
export const slugSchema = z
  .string()
  .max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const trace = { requestId: z.uuid() };
const version = z.number().int().positive().max(2147483646);
export const createJobSchema = z.strictObject({
  ...trace,
  id: z.uuid(),
  slug: slugSchema,
  draft: jobDraftSchema,
});
export const saveJobSchema = z.strictObject({
  ...trace,
  expectedVersion: version,
  slug: slugSchema,
  draft: jobDraftSchema,
});
export const duplicateJobSchema = z.strictObject({
  ...trace,
  id: z.uuid(),
  expectedVersion: version,
});
export const jobActionSchema = z.strictObject({
  ...trace,
  expectedVersion: version,
  action: z.enum(["submit", "publish", "pause", "resume", "close"]),
  allowChineseFallback: z.boolean().optional(),
});
