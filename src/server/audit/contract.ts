import { z } from "zod";

const uuid = z.uuid();
const role = z.enum(["ADMIN", "HR", "READ_ONLY"]);
export const auditCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);
// Historical codes are not trusted free text, even if they happen to be uppercase.
export const knownTypes = z.enum([
  "JOB",
  "APPLICATION",
  "CANDIDATE",
  "CONTENT",
  "CONTENT_IMAGE",
  "STAFF_PROFILE",
  "AUTH_ACCOUNT",
  "DEPARTMENT",
  "LOCATION",
  "JOB_OPTION",
  "CONTACT_MESSAGE",
  "PRIVACY_REQUEST",
  "PRIVACY_POLICY",
  "PRIVACY_HOLD",
  "PRIVACY_ERASURE",
]);
export const knownActions = z.enum([
  "JOB_CREATE",
  "JOB_SAVE",
  "JOB_DUPLICATE",
  "JOB_SUBMIT",
  "JOB_PUBLISH",
  "JOB_PAUSE",
  "JOB_RESUME",
  "JOB_CLOSE",
  "DEV_FIXTURE_SEEDED",
  "APPLICATION_STAGE_CHANGED",
  "CANDIDATES_MERGED",
  "CV_URL_ISSUED",
  "UPDATED",
  "CONFIRMED",
  "CONTENT_CREATE",
  "CONTENT_SAVE",
  "CONTENT_PUBLISH",
  "CONTENT_UNPUBLISH",
  "CONTENT_IMAGE_UPLOADED",
  "CONTENT_TEMPLATE_CREATED",
  "CONTENT_SEEDED",
  "STAFF_LINKED",
  "STAFF_CHANGED",
  "STAFF_DELETED",
  "STAFF_RENAMED",
  "STAFF_BOOTSTRAPPED",
  "STAFF_PROVIDER_SYNCED",
  "PASSWORD_CHANGED",
  "PASSWORD_CHANGE_UNCERTAIN",
  "DEPARTMENT_CREATED",
  "DEPARTMENT_UPDATED",
  "DEPARTMENT_DELETED",
  "LOCATION_CREATED",
  "LOCATION_UPDATED",
  "LOCATION_DELETED",
  "JOB_OPTION_CREATED",
  "JOB_OPTION_UPDATED",
  "CONTACT_MESSAGE_CREATED",
  "CONTACT_MESSAGE_UPDATED",
  "CONTACT_MESSAGE_DELETED",
  "DELETION_REQUESTED",
  "DELETION_VERIFIED",
  "DELETION_REJECTED",
  "DELETION_COMPLETED",
  "PRIVACY_HOLD_SET",
  "PRIVACY_HOLD_RELEASED",
  "PRIVACY_POLICY_CHANGED",
  "PERSONAL_DATA_ERASED",
]);
export const auditFields = [
  "code",
  "name_en",
  "name_zh",
  "active",
  "sort_order",
  "address_en",
  "address_zh",
  "country_code",
  "timezone",
  "state",
  "assigned_to",
] as const;

// Keep in sync with portal_private.audit_payload_is_safe. No free-text values,
// nested objects, contacts, tokens, hashes, filenames or request metadata.
export const safeAuditChanges = z
  .object({
    id: uuid.optional(),
    jobId: uuid.optional(),
    applicationId: uuid.optional(),
    candidateId: uuid.optional(),
    sourceId: uuid.optional(),
    uploadId: uuid.optional(),
    imageId: uuid.optional(),
    operationId: uuid.optional(),
    version: z.number().int().min(1).max(2147483647).optional(),
    applicationsMoved: z.number().int().min(0).max(2147483647).optional(),
    role: role.optional(),
    oldRole: role.optional(),
    active: z.boolean().optional(),
    oldActive: z.boolean().optional(),
    status: z
      .enum([
        "DRAFT",
        "PENDING_REVIEW",
        "PUBLISHED",
        "PAUSED",
        "CLOSED",
        "NEW",
        "SCREENING",
        "INTERVIEW",
        "OFFER",
        "REJECTED",
      ])
      .optional(),
    intakeState: z.literal("CONFIRMED").optional(),
    action: z.enum(["create", "save", "publish", "unpublish"]).optional(),
    reason: z.literal("EXPIRED").nullable().optional(),
    operation: z.enum(["ban", "unban"]).optional(),
    fixture: z.literal("pv-local-v1").optional(),
    fields: z.array(z.enum(auditFields)).max(20).optional(),
  })
  .strict()
  .refine((v) => new TextEncoder().encode(JSON.stringify(v)).length <= 4096);
export type SafeAuditChanges = z.infer<typeof safeAuditChanges>;

export const auditFilters = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    action: auditCode.optional(),
    objectType: auditCode.optional(),
    actorId: uuid.optional(),
    objectId: uuid.optional(),
    requestId: uuid.optional(),
    actor: z.literal("system").optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((v) => !(v.actor && v.actorId), { path: ["actorId"] })
  .refine((v) => !v.from || !v.to || Date.parse(v.from) < Date.parse(v.to), {
    path: ["to"],
  });
export type AuditFilters = z.infer<typeof auditFilters>;
export type AuditEntry = {
  id: string;
  at: string;
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string;
  requestId: string;
  changes: SafeAuditChanges;
  detailsAvailable: boolean;
  actorName?: string | null;
  objectLabel?: { en: string; zh: string } | null;
};
export type AuditPage = {
  entries: AuditEntry[];
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export function auditEntry(row: Record<string, unknown>): AuditEntry {
  const changes = safeAuditChanges.safeParse(row.safe_changes);
  const action = knownActions.safeParse(row.action),
    type = knownTypes.safeParse(row.object_type);
  return {
    id: uuid.parse(row.id),
    at: (row.created_at instanceof Date
      ? row.created_at
      : new Date(String(row.created_at))
    ).toISOString(),
    actorId: row.actor_id === null ? null : uuid.parse(row.actor_id),
    action: action.success ? action.data : "LEGACY_EVENT",
    objectType: type.success ? type.data : "LEGACY_OBJECT",
    objectId: uuid.parse(row.object_id),
    requestId: uuid.parse(row.request_id),
    changes: changes.success ? changes.data : {},
    detailsAvailable: changes.success && action.success && type.success,
  };
}
