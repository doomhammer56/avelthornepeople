import { z } from "zod";

const translatedText = z.object({
  en: z.string().trim().min(1),
  zh: z.string().trim().min(1),
});

// Validate and select only fields intended for public job summaries.
// Extra API fields never pass through to browser props or candidate-facing components.
const publicJobSchema = z.object({
  id: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: translatedText,
  department: translatedText,
  location: translatedText,
  type: translatedText,
  experience: translatedText.nullable().optional(),
  postedAt: z.iso.date(),
  /** Application deadline when set; omitted or null when the role has no fixed close date. */
  closesAt: z.iso.date().nullable().optional(),
  contentLanguage: z.enum(["en", "zh"]).optional(),
});

export type PublicJobSummary = z.infer<typeof publicJobSchema>;

// Extend public summaries with the content needed by a single vacancy page.
// Plain-text lists are rendered as text rather than accepting arbitrary backend HTML.
const translatedList = z.object({
  en: z.array(z.string().trim().min(1)).min(1),
  zh: z.array(z.string().trim().min(1)).min(1),
});
const publicJobDetailSchema = publicJobSchema
  .extend({
    employmentType: z
      .enum([
        "FULL_TIME",
        "PART_TIME",
        "CONTRACTOR",
        "TEMPORARY",
        "INTERN",
        "OTHER",
      ])
      .optional(),
    responsibilities: translatedList,
    requirements: translatedList,
    closesAt: z
      .union([z.iso.date(), z.iso.datetime({ offset: true })])
      .transform((value) =>
        value.length === 10 ? value : new Date(value).toISOString(),
      )
      .nullable(),
    status: z.enum(["open", "closed"]),
    showSalary: z.boolean().optional(),
    salary: z
      .object({
        min: z.number().finite().nonnegative(),
        max: z.number().finite().nonnegative(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        period: translatedText,
        periodCode: z.enum(["HOUR", "DAY", "MONTH", "YEAR"]).optional(),
      })
      .refine((salary) => salary.min <= salary.max)
      .nullable()
      .optional(),
  })
  .refine(
    (job) =>
      !job.closesAt || Date.parse(job.closesAt) >= Date.parse(job.postedAt),
    {
      message: "Invalid public job dates",
    },
  );
export type PublicJobDetail = z.infer<typeof publicJobDetailSchema>;

// Validate the single-job envelope independently from the collection contract.
// Unexpected internal fields are stripped before any record reaches a public page.
export function parsePublicJob(payload: unknown): PublicJobDetail {
  const job = z.object({ job: publicJobDetailSchema }).parse(payload).job;
  // Remove undisclosed compensation before the public record reaches any component.
  // Only an explicit backend visibility flag permits salary rendering or serialization.
  if (job.showSalary !== true) delete job.salary;
  return job;
}

// Reject invalid payloads and duplicate identifiers at the API boundary.
// This provisional envelope stays isolated until the backend DTO is agreed.
export function parsePublicJobs(payload: unknown): PublicJobSummary[] {
  const { jobs } = z.object({ jobs: z.array(publicJobSchema) }).parse(payload);
  if (
    new Set(jobs.map((job) => job.id)).size !== jobs.length ||
    new Set(jobs.map((job) => job.slug)).size !== jobs.length
  ) {
    throw new Error("Invalid public job identifiers");
  }
  return jobs;
}
