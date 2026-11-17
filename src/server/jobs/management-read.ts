import { can, rolesFor } from "../../lib/auth/permissions.ts";
import "server-only";
import type pg from "pg";
import type { StaffIdentity } from "../auth/identity.ts";
import { staffRead } from "../admin/read.ts";
import { adminJobDto, adminJobSummaryDto } from "../admin/dto.ts";
import { jobStatuses, type JobListQuery } from "./management-contract.ts";
import { safeCount } from "../dashboard/contract.ts";

export function adminJobProjection(role: string, summary = false) {
  const applications = !can(role, "applications.read")
    ? "NULL::text"
    : "(SELECT count(*)::text FROM portal.applications a WHERE a.job_id=j.id AND a.intake_state='CONFIRMED')";
  // Equal snapshots prove there are no changes. Unequal/legacy snapshots retain
  // the exact JS comparison (including normalized dates and ignored fields).
  const unchanged = `(CASE WHEN j.published_content IS NULL THEN true
    WHEN jsonb_typeof(j.published_content)='object' THEN j.draft_content=j.published_content-'englishFallback'
    ELSE false END)`;
  const columns = summary
    ? `j.id,j.created_at,j.canonical_slug,j.status,j.version,j.department_id,j.job_type,j.experience,
    j.salary_min,j.salary_max,j.salary_currency,j.salary_period,j.show_salary,j.publish_at,j.close_at,
    CASE WHEN ${unchanged} THEN jsonb_build_object(
      'en',jsonb_build_object('title',j.draft_content#>'{en,title}'),
      'zh',jsonb_build_object('title',j.draft_content#>'{zh,title}'),
      'settings',j.draft_content->'settings') ELSE j.draft_content END AS draft_content,
    CASE WHEN ${unchanged} THEN NULL ELSE j.published_content END AS published_content`
    : "j.*";
  return `${columns},
    j.status='PUBLISHED' AND j.published_content IS NOT NULL AND j.approved_at IS NOT NULL AND j.published_version IS NOT NULL
    AND j.publish_at<=statement_timestamp() AND (j.close_at IS NULL OR j.close_at>statement_timestamp()) AS live,
    ARRAY(SELECT jl.location_id::text FROM portal.job_locations jl WHERE jl.job_id=j.id ORDER BY jl.location_id) AS location_ids,
    ${applications} AS applications`;
}
export async function selectAdminJobs(
  db: pg.PoolClient,
  role: string,
  ids: string[] | null,
) {
  const { rows } = await db.query(
    `SELECT ${adminJobProjection(role)} FROM portal.jobs j
    WHERE ($1::uuid[] IS NULL OR j.id=ANY($1::uuid[])) ORDER BY j.created_at DESC,j.id DESC`,
    [ids],
  );
  return rows.map(adminJobDto);
}
export function listAdminJobs(identity: StaffIdentity, query: JobListQuery) {
  return readAdminJobPage(identity, query, adminJobDto);
}
export function listAdminJobSummaries(
  identity: StaffIdentity,
  query: JobListQuery,
) {
  return readAdminJobPage(identity, query, adminJobSummaryDto, true);
}
function readAdminJobPage<T>(
  identity: StaffIdentity,
  query: JobListQuery,
  map: (row: Record<string, unknown>) => T,
  summary = false,
) {
  return staffRead(identity, rolesFor("jobs.read"), async (db, staff) => {
    // A single query computes totals and rows against the same statement snapshot.
    const { rows } = await db.query(
      `WITH matched AS MATERIALIZED (
      SELECT id,status FROM portal.jobs j WHERE $1='' OR strpos(lower(concat_ws(' ',j.draft_content#>>'{en,title}',j.draft_content#>>'{zh,title}',j.canonical_slug)),lower($1))>0 OR j.id::text=lower($1)
    ), selected AS (SELECT ${adminJobProjection(staff.role, summary)} FROM matched m JOIN portal.jobs j ON j.id=m.id WHERE $2::text[] IS NULL OR m.status=ANY($2::text[])
      ORDER BY j.created_at DESC,j.id DESC LIMIT $3 OFFSET $4)
    SELECT (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.created_at DESC,s.id DESC),'[]'::jsonb) FROM selected s) AS jobs,
      (SELECT count(*)::text FROM matched WHERE $2::text[] IS NULL OR status=ANY($2::text[])) AS total,
      (SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*)::text n FROM matched GROUP BY status) counts) AS counts`,
      [
        query.q,
        query.statuses.length
          ? query.statuses.map((s) => jobStatuses[s])
          : null,
        query.pageSize,
        (query.page - 1) * query.pageSize,
      ],
    );
    const result = rows[0];
    const statusCounts = Object.fromEntries(
      Object.entries(jobStatuses).map(([key, value]) => [
        key,
        safeCount(result.counts?.[value] ?? "0"),
      ]),
    );
    const jobs = (result.jobs as Record<string, unknown>[]).map(map);
    return {
      jobs,
      total: safeCount(result.total),
      page: query.page,
      pageSize: query.pageSize,
      statusCounts,
    };
  });
}
