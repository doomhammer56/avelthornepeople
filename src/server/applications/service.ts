import { rolesFor } from "../../lib/auth/permissions.ts";
import "server-only";
import type pg from "pg";
import { z } from "zod";
import { staffRead } from "../admin/read.ts";
import type { StaffIdentity } from "../auth/identity.ts";
import { adminApplicationDto } from "../admin/dto.ts";
import {
  candidateDto,
  selectCandidate,
  applicationMatchFlags,
} from "../candidates/service.ts";
import {
  candidateProfile,
  contactKeys,
  decryptProfileValue,
  profileSchema,
  ProfileUnavailable,
} from "../candidates/crypto.ts";
import {
  stages,
  applicationSearch,
  stageCommand,
  type ApplicationQuery,
} from "./contract.ts";
import { RecruitmentError } from "./errors.ts";

const sourceSql = `CASE WHEN lower(a.source) IN('site','careers','website') THEN 'site' WHEN lower(a.source) IN('linkedin','jobstreet','referral') THEN lower(a.source) ELSE 'other' END`;
export const applicationListColumns = `a.id,a.job_id,a.candidate_id,a.source,a.status,a.submitted_at,a.consent_at,a.policy_version,
  a.version,a.cv_scan_state,a.locale`;
const selectSql = (
  detail = false,
) => `SELECT ${detail ? "a.*" : applicationListColumns},j.draft_content->'zh'->>'title' job_zh,j.draft_content->'en'->>'title' job_en,
  c.name_encrypted,c.email_encrypted,c.phone_encrypted,portal_private.candidate_group_blocked(c.id) blocked,
  u.id IS NOT NULL AND u.scan_state IN('CLEAN','UNSCANNED') AND u.access_revoked_at IS NULL cv_available,
  false live_duplicate
  FROM portal.applications a JOIN portal.jobs j ON j.id=a.job_id LEFT JOIN portal.candidates c ON c.id=a.candidate_id LEFT JOIN portal.uploads u ON u.id=a.cv_upload_id`;
function dto(row: Record<string, unknown>) {
  const base = adminApplicationDto({
      ...row,
      cv_available: row.cv_available === true && !row.blocked,
    }),
    profile = row.blocked
      ? null
      : candidateProfile({ ...row, id: row.candidate_id });
  return {
    ...base,
    cvUnscanned: row.cv_scan_state === "UNSCANNED",
    version: Number(row.version),
    name: profile?.name ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    profileAvailable: !!profile,
    duplicate: row.live_duplicate === true,
    jobTitle: { en: String(row.job_en ?? ""), zh: String(row.job_zh ?? "") },
  };
}
export type ManagedApplication = ReturnType<typeof dto>;
export type ApplicationPage = {
  applications: ManagedApplication[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<(typeof stages)[number], number>;
};
export async function selectApplicationPage(
  db: pg.PoolClient,
  input: ApplicationQuery,
): Promise<ApplicationPage> {
  const params: unknown[] = [];
  const clauses = ["a.intake_state='CONFIRMED'"];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (input.jobId) clauses.push(`a.job_id=${bind(input.jobId)}::uuid`);
  if (input.candidateId)
    clauses.push(
      `a.candidate_id=(SELECT coalesce(merged_into_id,id) FROM portal.candidates WHERE id=${bind(input.candidateId)}::uuid)`,
    );
  if (input.source) clauses.push(`${sourceSql}=${bind(input.source)}`);
  if (input.from)
    clauses.push(`a.submitted_at>=${bind(input.from)}::timestamptz`);
  if (input.to) clauses.push(`a.submitted_at<${bind(input.to)}::timestamptz`);
  if (input.email || input.phone) {
    let keys;
    try {
      keys = contactKeys(input.email, input.phone, input.region);
    } catch (error) {
      if (error instanceof ProfileUnavailable) throw error;
      throw new RecruitmentError(400);
    }
    for (const field of ["email", "phone"] as const)
      if (input[field]) {
        const token = bind(
          JSON.stringify(keys.filter((k) => k.field === field)),
        );
        clauses.push(
          `EXISTS(SELECT 1 FROM jsonb_to_recordset(${token}::jsonb) AS k(version integer,hash text) JOIN portal.candidates c ON c.hmac_key_version=k.version AND c.${field}_hmac=decode(k.hash,'hex') WHERE coalesce(c.merged_into_id,c.id)=a.candidate_id)`,
        );
      }
  }
  const where = clauses.join(" AND ");
  const statusClause = input.status.length
    ? `a.status=ANY(${bind(input.status)}::text[])`
    : "true";
  // Counts and the page must share a statement snapshot. Keep page columns in
  // their native pg types (especially bytea), including when the page is empty.
  const { rows } = await db.query(
    `WITH counts AS (
       SELECT coalesce(jsonb_object_agg(status,n),'{}'::jsonb) stage_counts
       FROM (SELECT a.status,count(*)::text n FROM portal.applications a
         WHERE ${where} GROUP BY a.status) grouped
     )
     SELECT page.*,counts.stage_counts FROM counts LEFT JOIN LATERAL (
       ${selectSql()} WHERE ${where} AND ${statusClause}
       ORDER BY a.submitted_at DESC,a.id DESC
       LIMIT ${bind(input.pageSize)} OFFSET ${bind((input.page - 1) * input.pageSize)}
     ) page ON true ORDER BY page.submitted_at DESC,page.id DESC`,
    params,
  );
  const counts = Object.fromEntries(
    stages.map((stage) => [stage, 0]),
  ) as ApplicationPage["counts"];
  for (const [stage, count] of Object.entries(rows[0]?.stage_counts ?? {}))
    counts[stage as keyof typeof counts] = Number(count);
  const total = input.status.length
    ? input.status.reduce((n, stage) => n + counts[stage], 0)
    : Object.values(counts).reduce((n, v) => n + v, 0);
  const applicationRows = rows.filter((row) => row.id !== null);
  await applicationMatchFlags(db, applicationRows);
  return {
    applications: applicationRows.map(dto),
    total,
    page: input.page,
    pageSize: input.pageSize,
    counts,
  };
}
export function listApplications(identity: StaffIdentity, query: unknown = {}) {
  const input = applicationSearch.parse(query);
  return staffRead(identity, rolesFor("applications.read"), (db) =>
    selectApplicationPage(db, input),
  );
}
export function applicationDetails(identity: StaffIdentity, id: string) {
  return staffRead(identity, rolesFor("applications.read"), async (db) => {
    const { rows } = await db.query(
      `${selectSql(true)} WHERE a.id=$1 AND a.intake_state='CONFIRMED'`,
      [z.uuid().parse(id)],
    );
    const row = rows[0];
    if (!row) throw new RecruitmentError(404);
    await applicationMatchFlags(db, rows);
    let submittedProfile = null;
    let coverLetter: string | null = null;
    try {
      if (!row.blocked)
        submittedProfile = profileSchema.parse(
          decryptProfileValue(
            row.profile_encrypted,
            `application:${row.id}:profile`,
          ),
        );
    } catch {}
    try {
      if (!row.blocked && row.cover_letter_encrypted)
        coverLetter = z
          .string()
          .max(5000)
          .parse(
            decryptProfileValue(
              row.cover_letter_encrypted,
              `application:${row.id}:coverLetter`,
            ),
          );
    } catch {}
    return {
      application: dto(row),
      submittedProfile,
      coverLetter,
      candidate: row.candidate_id
        ? candidateDto(await selectCandidate(db, row.candidate_id))
        : null,
    };
  });
}
export type ApplicationDetails = Awaited<ReturnType<typeof applicationDetails>>;
export function changeApplicationStage(
  identity: StaffIdentity,
  id: string,
  body: unknown,
) {
  const input = stageCommand.parse(body);
  return staffRead(identity, rolesFor("applications.write"), async (db) => {
    const { rows } = await db.query(
      "SELECT portal_private.manage_recruitment('stage',$1,$2,$3,$4) result",
      [
        z.uuid().parse(id),
        input.expectedVersion,
        input.requestId,
        input.status,
      ],
    );
    return { result: rows[0].result };
  });
}
export const applicationJobOptionSql = `WITH eligible AS NOT MATERIALIZED (SELECT j.id,j.draft_content->'zh'->>'title' zh,j.draft_content->'en'->>'title' en FROM portal.jobs j WHERE EXISTS(SELECT 1 FROM portal.applications a WHERE a.job_id=j.id AND a.intake_state='CONFIRMED')),
        page AS (SELECT * FROM eligible WHERE $1='' OR strpos(lower(concat_ws(' ',en,zh,id::text)),lower($1))>0 ORDER BY id LIMIT 100 OFFSET $2)
        SELECT * FROM page UNION ALL SELECT * FROM eligible WHERE id=$3::uuid AND NOT EXISTS(SELECT 1 FROM page WHERE id=$3::uuid)`;

export function applicationJobOptions(
  identity: StaffIdentity,
  query: { q?: string; page?: number; selected?: string } = {},
) {
  const q = (query.q ?? "").trim();
  const page = query.page ?? 1;
  if (
    q.length > 200 ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    (query.selected && !z.uuid().safeParse(query.selected).success)
  )
    throw new RecruitmentError(400);
  return staffRead(identity, rolesFor("applications.read"), async (db) =>
    (
      await db.query(applicationJobOptionSql, [
        q,
        (page - 1) * 100,
        query.selected ?? null,
      ])
    ).rows.map((row) => ({
      id: String(row.id),
      en: String(row.en ?? ""),
      zh: String(row.zh ?? ""),
    })),
  );
}
