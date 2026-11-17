import { z } from "zod";

export const deletionStates = [
  "REQUESTED",
  "VERIFIED",
  "PROCESSING",
  "COMPLETED",
  "REJECTED",
  "ON_HOLD",
] as const;
const uuid = z.uuid();
const version = z.number().int().min(1).max(2147483647);
export const privacyPolicyId = "00000000-0000-4000-8000-000000000001";

export const createDeletionRequest = z
  .object({
    id: uuid,
    candidateId: uuid,
    requesterRef: uuid,
    requestId: uuid,
    receivedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export const deletionDecision = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("verify"),
      expectedVersion: version,
      requestId: uuid,
    })
    .strict(),
  z
    .object({
      action: z.literal("reject"),
      expectedVersion: version,
      requestId: uuid,
      reasonCode: z.enum([
        "IDENTITY_UNVERIFIED",
        "DUPLICATE",
        "NOT_APPLICABLE",
      ]),
    })
    .strict(),
]);
export const legalHoldCommand = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("hold"),
      expectedVersion: z.number().int().min(0).max(2147483647),
      requestId: uuid,
      caseRef: uuid,
      reasonCode: z.enum(["LEGAL_OBLIGATION", "LEGAL_CLAIM"]),
      until: z.iso.datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal("release"),
      expectedVersion: version,
      requestId: uuid,
    })
    .strict(),
]);
export const privacyPolicyCommand = z
  .object({
    expectedVersion: version,
    requestId: uuid,
    retentionMonths: z.number().int().min(1).max(24),
    evidenceMonths: z.number().int().min(1).max(24),
    retentionEnabled: z.boolean(),
  })
  .strict();
export const privacyFilters = z
  .object({
    state: z.enum(deletionStates).optional(),
    overdue: z.literal("1").optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export const publicDeletionRequest = z
  .object({
    resumeToken: z.string().regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/i),
  })
  .strict();
