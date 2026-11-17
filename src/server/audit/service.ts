import { rolesFor } from "../../lib/auth/permissions.ts";
import "server-only";
import type { StaffIdentity } from "../auth/identity.ts";
import { staffRead } from "../admin/read.ts";
import { auditEntry, auditFilters, type AuditPage } from "./contract.ts";
import { auditPresentation } from "./presentation.ts";

export function readAudit(
  identity: StaffIdentity,
  input: unknown = {},
): Promise<AuditPage> {
  const filters = auditFilters.parse(input);
  return staffRead(identity, rolesFor("audit.read"), async (db) => {
    const { rows } = await db.query(
      `WITH page AS (SELECT id,created_at,actor_id,action,object_type,object_id,request_id,safe_changes
       FROM portal.audit_logs
       WHERE ($1::text IS NULL OR action=$1) AND ($2::text IS NULL OR object_type=$2)
         AND ($3::uuid IS NULL OR actor_id=$3) AND ($4::uuid IS NULL OR object_id=$4)
         AND ($5::uuid IS NULL OR request_id=$5) AND (NOT $6::boolean OR actor_id IS NULL)
         AND ($7::timestamptz IS NULL OR created_at >= $7)
         AND ($8::timestamptz IS NULL OR created_at < $8)
       ORDER BY created_at DESC,id DESC LIMIT $9 OFFSET $10)
       SELECT a.*,actor.display_name actor_name,target.display_name target_name,c.type content_type,
         coalesce(nullif(j.draft_content#>>'{en,title}',''),j.published_content#>>'{en,title}',j.canonical_slug) job_en,
         coalesce(nullif(j.draft_content#>>'{zh,title}',''),j.published_content#>>'{zh,title}',j.canonical_slug) job_zh,
         coalesce(d.name_en,l.name_en,o.name_en) lookup_en,coalesce(d.name_zh,l.name_zh,o.name_zh) lookup_zh,
         coalesce(nullif(aj.draft_content#>>'{en,title}',''),aj.published_content#>>'{en,title}',aj.canonical_slug) application_job_en,
         coalesce(nullif(aj.draft_content#>>'{zh,title}',''),aj.published_content#>>'{zh,title}',aj.canonical_slug) application_job_zh
       FROM page a
       LEFT JOIN portal.staff_profiles actor ON actor.id=a.actor_id
       LEFT JOIN portal.staff_profiles target ON a.object_type IN('STAFF_PROFILE','AUTH_ACCOUNT') AND target.id=a.object_id
       LEFT JOIN portal.content_blocks c ON a.object_type='CONTENT' AND c.id=a.object_id
       LEFT JOIN portal.jobs j ON a.object_type='JOB' AND j.id=a.object_id
       LEFT JOIN portal.departments d ON a.object_type='DEPARTMENT' AND d.id=a.object_id
       LEFT JOIN portal.locations l ON a.object_type='LOCATION' AND l.id=a.object_id
       LEFT JOIN portal.job_options o ON a.object_type='JOB_OPTION' AND o.id=a.object_id
       LEFT JOIN portal.applications app ON a.object_type='APPLICATION' AND app.id=a.object_id
       LEFT JOIN portal.jobs aj ON aj.id=app.job_id
       ORDER BY a.created_at DESC,a.id DESC`,
      [
        filters.action ?? null,
        filters.objectType ?? null,
        filters.actorId ?? null,
        filters.objectId ?? null,
        filters.requestId ?? null,
        filters.actor === "system",
        filters.from ?? null,
        filters.to ?? null,
        filters.pageSize + 1,
        (filters.page - 1) * filters.pageSize,
      ],
    );
    return {
      entries: rows
        .slice(0, filters.pageSize)
        .map((row) => auditPresentation(auditEntry(row), row)),
      page: filters.page,
      pageSize: filters.pageSize,
      hasMore: rows.length > filters.pageSize,
    };
  });
}
