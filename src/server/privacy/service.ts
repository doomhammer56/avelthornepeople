import "server-only";
import type { StaffIdentity } from "../auth/identity.ts";
import { staffRead } from "../admin/read.ts";
import { rolesFor } from "../../lib/auth/permissions.ts";
import { z } from "zod";
import {
  createDeletionRequest,
  deletionDecision,
  legalHoldCommand,
  privacyFilters,
  privacyPolicyCommand,
  privacyPolicyId,
} from "./contract.ts";

const roles = rolesFor("privacy.manage");
const iso = (value: unknown) =>
  value == null
    ? null
    : (value instanceof Date ? value : new Date(String(value))).toISOString();
const cleanup = z
  .object({
    database: z.literal("removed").optional(),
    storage: z.literal("removed").optional(),
  })
  .strict();
function requestDto(row: Record<string, unknown>) {
  const progress = cleanup.safeParse(row.cleanup_progress);
  return {
    id: row.id,
    candidateId: row.candidate_id,
    requesterRef: row.verified_requester_ref,
    state: row.state,
    version: row.version,
    decisionCode: row.decision_code,
    requestedAt: iso(row.requested_at),
    dueAt: iso(row.due_at),
    verifiedAt: iso(row.verified_at),
    verifiedBy: row.verified_by,
    completedAt: iso(row.completed_at),
    overdue:
      !["COMPLETED", "REJECTED"].includes(String(row.state)) &&
      new Date(String(row.due_at)).getTime() <= Date.now(),
    cleanup: progress.success ? progress.data : {},
  };
}
export function readDeletionRequests(
  identity: StaffIdentity,
  input: unknown,
  id?: string,
) {
  const filters = privacyFilters.parse(input);
  if (id) z.uuid().parse(id);
  return staffRead(identity, roles, async (db) => {
    const { rows } = await db.query(
      `SELECT id,candidate_id,verified_requester_ref,state,version,decision_code,
      requested_at,due_at,verified_at,verified_by,completed_at,cleanup_progress
      FROM portal.deletion_requests WHERE ($1::uuid IS NULL OR id=$1) AND ($2::text IS NULL OR state=$2)
        AND (NOT $3::boolean OR (state NOT IN('COMPLETED','REJECTED') AND due_at<=statement_timestamp()))
      ORDER BY due_at,id LIMIT $4 OFFSET $5`,
      [
        id ?? null,
        filters.state ?? null,
        filters.overdue === "1",
        filters.pageSize + 1,
        (filters.page - 1) * filters.pageSize,
      ],
    );
    return {
      requests: rows.slice(0, filters.pageSize).map(requestDto),
      hasMore: rows.length > filters.pageSize,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  });
}
export function readPrivacyPolicy(identity: StaffIdentity) {
  return staffRead(identity, roles, async (db) => {
    const {
      rows: [row],
    } = await db.query("SELECT * FROM portal.privacy_policy WHERE id=1");
    return {
      retentionMonths: row.retention_months,
      evidenceMonths: row.evidence_months,
      retentionEnabled: row.retention_enabled,
      version: row.version,
      updatedAt: iso(row.updated_at),
    };
  });
}
export function readLegalHolds(identity: StaffIdentity, input: unknown) {
  const filters = privacyFilters
    .omit({ state: true, overdue: true })
    .parse(input);
  return staffRead(identity, roles, async (db) => {
    const { rows } = await db.query(
      `SELECT candidate_id,case_ref,reason_code,hold_until,released_at,version
      FROM portal.candidate_legal_holds ORDER BY hold_until,candidate_id LIMIT $1 OFFSET $2`,
      [filters.pageSize + 1, (filters.page - 1) * filters.pageSize],
    );
    return {
      holds: rows.slice(0, filters.pageSize).map((row) => ({
        candidateId: row.candidate_id,
        caseRef: row.case_ref,
        reasonCode: row.reason_code,
        until: iso(row.hold_until),
        releasedAt: iso(row.released_at),
        version: row.version,
      })),
      hasMore: rows.length > filters.pageSize,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  });
}
function execute(
  identity: StaffIdentity,
  kind: string,
  id: string,
  expected: number | null,
  request: string,
  body: unknown,
) {
  return staffRead(
    identity,
    roles,
    async (db) =>
      (
        await db.query(
          "SELECT portal_private.manage_privacy($1,$2,$3,$4,$5::jsonb) result",
          [kind, id, expected, request, JSON.stringify(body)],
        )
      ).rows[0].result,
  );
}
export function registerDeletionRequest(
  identity: StaffIdentity,
  input: unknown,
) {
  const { id, requestId, ...body } = createDeletionRequest.parse(input);
  return execute(identity, "request", id, null, requestId, body);
}
export function decideDeletionRequest(
  identity: StaffIdentity,
  id: string,
  input: unknown,
) {
  z.uuid().parse(id);
  const { action, requestId, expectedVersion, ...body } =
    deletionDecision.parse(input);
  return execute(identity, action, id, expectedVersion, requestId, body);
}
export function manageLegalHold(
  identity: StaffIdentity,
  id: string,
  input: unknown,
) {
  z.uuid().parse(id);
  const { action, requestId, expectedVersion, ...body } =
    legalHoldCommand.parse(input);
  return execute(identity, action, id, expectedVersion, requestId, body);
}
export function updatePrivacyPolicy(identity: StaffIdentity, input: unknown) {
  const { expectedVersion, requestId, ...body } =
    privacyPolicyCommand.parse(input);
  return execute(
    identity,
    "policy",
    privacyPolicyId,
    expectedVersion,
    requestId,
    body,
  );
}
