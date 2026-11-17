import { z } from "zod";
import { staffRoles } from "../../lib/auth/permissions.ts";
import type { StaffRole } from "../../lib/auth/permissions.ts";
const request = { requestId: z.uuid() };
const name = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
export const staffCommand = z.discriminatedUnion("action", [
  z
    .object({
      ...request,
      action: z.literal("invite"),
      displayName: name,
      email: z
        .string()
        .trim()
        .max(254)
        .pipe(z.email())
        .transform((value) => value.toLowerCase()),
      role: z.enum(staffRoles).optional(),
      // Activate straight away so the member can sign in once they set a
      // password. Omitted/false keeps the older inactive-until-reviewed default.
      active: z.boolean().optional(),
      // Language of the invitation email.
      lang: z.enum(["en", "zh"]).optional(),
    })
    .strict(),
  z
    .object({
      ...request,
      action: z.literal("link"),
      displayName: name,
      userId: z.uuid(),
      role: z.enum(staffRoles).optional(),
      active: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...request,
      action: z.literal("change"),
      userId: z.uuid(),
      role: z.enum(staffRoles),
      active: z.boolean(),
      expectedVersion: z.number().int().positive().max(2147483647),
    })
    .strict(),
  // Permanently removes a deactivated member who has no history tied to them.
  z
    .object({
      ...request,
      action: z.literal("delete"),
      userId: z.uuid(),
      expectedVersion: z.number().int().positive().max(2147483647),
    })
    .strict(),
  z
    .object({
      ...request,
      action: z.literal("reconcile"),
      operationId: z.uuid(),
    })
    .strict(),
]);
export type StaffCommand = z.infer<typeof staffCommand>;
export type TeamAccount = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  active: boolean;
  version: number;
  pendingOperationId: string | null;
  scope: { en: string; zh: string };
  lastLogin: { en: string; zh: string };
};
