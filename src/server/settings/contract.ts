import { z } from "zod";

const fields = {
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  nameEn: z.string().trim().min(1).max(120),
  nameZh: z.string().trim().min(1).max(120),
  active: z.boolean(),
};
const common = {
  id: z.uuid(),
  expectedVersion: z.number().int().min(0).max(2147483646),
  requestId: z.uuid(),
};
const ordinary = (category: "department" | "jobType" | "experience") =>
  z
    .object({
      ...common,
      category: z.literal(category),
      value: z.object(fields).strict(),
    })
    .strict();
export const referenceCommand = z.discriminatedUnion("category", [
  ordinary("department"),
  ordinary("jobType"),
  ordinary("experience"),
  z
    .object({
      ...common,
      category: z.literal("location"),
      value: z
        .object({
          ...fields,
          countryCode: z.string().regex(/^[A-Z]{2}$/),
          timeZone: z
            .string()
            .min(1)
            .max(100)
            .refine((v) => {
              try {
                new Intl.DateTimeFormat("en", { timeZone: v });
                return true;
              } catch {
                return false;
              }
            }),
          addressEn: z.string().trim().max(300).optional(),
          addressZh: z.string().trim().max(300).optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type ReferenceCommand = z.infer<typeof referenceCommand>;
