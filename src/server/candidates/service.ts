import { rolesFor } from "../../lib/auth/permissions.ts";
import "server-only";
import type pg from "pg";
import { z } from "zod";
import { staffRead } from "../admin/read.ts";
import type { StaffIdentity } from "../auth/identity.ts";
import { candidateProfile, contactKeys, ProfileUnavailable } from "./crypto.ts";
import { pagination, mergeCommand } from "../applications/contract.ts";
import { RecruitmentError } from "../applications/errors.ts";
import type {
  CandidateSummary,
  MatchPage,
} from "../../lib/admin/recruitment.ts";

export function candidateDto(row: Record<string, unknown>): CandidateSummary {
  const profile = row.blocked ? null : candidateProfile(row);
  return {
    id: String(row.id),
    version: Number(row.version),
    name: profile?.name ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    profileAvailable: !!profile,
    available: !row.blocked,
    mergeAllowed: !!profile && !row.blocked,
    applicationCount: Number(row.application_count ?? 0),
  };
}
export async function selectCandidate(db: pg.PoolClient, id: string) {
  const { rows } = await db.query(
    `SELECT c.*,portal_private.candidate_group_blocked(c.id) blocked,
    (SELECT count(*) FROM portal.applications a WHERE a.candidate_id=c.id AND a.intake_state='CONFIRMED') application_count
    FROM portal.candidates c WHERE c.id=(SELECT coalesce(merged_into_id,id) FROM portal.candidates WHERE id=$1)`,
    [id],
  );
  if (!rows[0]) throw new RecruitmentError(404);
  return rows[0];
}
export function readCandidate(identity: StaffIdentity, id: string) {
  return staffRead(identity, rolesFor("applications.read"), async (db) =>
    candidateDto(await selectCandidate(db, z.uuid().parse(id))),
  );
}
export async function groupContactKeys(db: pg.PoolClient, id: string) {
  const { rows } = await db.query(
    "SELECT * FROM portal.candidates WHERE id=$1 OR merged_into_id=$1 ORDER BY id",
    [id],
  );
  return rows.flatMap((row) => {
    const profile = candidateProfile(row);
    if (!profile) throw new ProfileUnavailable();
    // A legacy invalid phone must not prevent email matching.
    const emailKeys = contactKeys(profile.email);
    let phoneKeys: ReturnType<typeof contactKeys> = [];
    try {
      phoneKeys = contactKeys(undefined, profile.phone, profile.phoneRegion);
    } catch (error) {
      if (error instanceof ProfileUnavailable) throw error;
    }
    return [...emailKeys, ...phoneKeys];
  });
}
// One indexed lookup for the whole application page, including aliases and old
// HMAC versions, rather than a query per row or a plaintext contact scan.
export async function applicationMatchFlags(
  db: pg.PoolClient,
  rows: Record<string, unknown>[],
) {
  const ids = [
    ...new Set(
      rows.filter((row) => !row.blocked).map((row) => String(row.candidate_id)),
    ),
  ];
  if (!ids.length) return;
  const aliases = (
    await db.query(
      "SELECT id,merged_into_id,name_encrypted,email_encrypted,phone_encrypted FROM portal.candidates WHERE coalesce(merged_into_id,id)=ANY($1::uuid[])",
      [ids],
    )
  ).rows;
  const available = new Set<string>();
  const lookups = aliases.flatMap((alias) => {
    const profile = candidateProfile(alias),
      id = String(alias.merged_into_id ?? alias.id);
    if (!profile) return [];
    try {
      const keys = contactKeys(profile.email);
      try {
        keys.push(
          ...contactKeys(undefined, profile.phone, profile.phoneRegion),
        );
      } catch (error) {
        if (error instanceof ProfileUnavailable) throw error;
      }
      available.add(id);
      return keys.map((key) => ({ ...key, candidate_id: id }));
    } catch {
      return [];
    }
  });
  const matched = lookups.length
    ? (
        await db.query(
          `SELECT DISTINCT k.candidate_id FROM jsonb_to_recordset($1::jsonb) AS k(candidate_id uuid,version integer,field text,hash text)
    JOIN portal.candidates c ON c.hmac_key_version=k.version AND ((k.field='email' AND c.email_hmac=decode(k.hash,'hex')) OR(k.field='phone' AND c.phone_hmac=decode(k.hash,'hex')))
    WHERE coalesce(c.merged_into_id,c.id)<>k.candidate_id`,
          [JSON.stringify(lookups)],
        )
      ).rows
    : [];
  const matchedIds = new Set(matched.map((row) => String(row.candidate_id)));
  const unavailable = ids.filter((id) => !available.has(id));
  if (unavailable.length) {
    // Retain the previous same-version fallback when a profile/key cannot be
    // decoded. Do this once per root only when needed, rather than per
    // application followed by another calculation for every readable profile.
    const fallback = await db.query(
      `SELECT root.id FROM unnest($1::uuid[]) root(id) WHERE EXISTS(
        SELECT 1 FROM portal.candidates alias JOIN portal.candidates other
          ON other.hmac_key_version=alias.hmac_key_version
          AND (other.email_hmac=alias.email_hmac OR other.phone_hmac=alias.phone_hmac)
        WHERE coalesce(alias.merged_into_id,alias.id)=root.id
          AND coalesce(other.merged_into_id,other.id)<>root.id)`,
      [unavailable],
    );
    for (const row of fallback.rows) matchedIds.add(String(row.id));
  }
  for (const row of rows)
    if (!row.blocked)
      row.live_duplicate = matchedIds.has(String(row.candidate_id));
}
export async function selectMatches(
  db: pg.PoolClient,
  id: string,
  page = 1,
  pageSize = 20,
): Promise<MatchPage> {
  const root = await selectCandidate(db, id);
  if (root.blocked) throw new RecruitmentError(409);
  const keys = await groupContactKeys(db, String(root.id));
  return findContactMatches(db, keys, String(root.id), page, pageSize);
}
// Trusted services can also match a new intake's normalized contacts before a
// candidate is created. This helper only reads; attachment remains transactional.
export async function findContactMatches(
  db: pg.PoolClient,
  keys: ReturnType<typeof contactKeys>,
  excludeId: string | null = null,
  page = 1,
  pageSize = 20,
): Promise<MatchPage> {
  const cte = `WITH lookup AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS k(version integer,field text,hash text)),
    matched AS (SELECT coalesce(c.merged_into_id,c.id) id,bool_or(k.field='email') email,bool_or(k.field='phone') phone
      FROM lookup k JOIN portal.candidates c ON c.hmac_key_version=k.version AND
       ((k.field='email' AND c.email_hmac=decode(k.hash,'hex')) OR (k.field='phone' AND c.phone_hmac=decode(k.hash,'hex')))
      WHERE ($2::uuid IS NULL OR coalesce(c.merged_into_id,c.id)<>$2::uuid) GROUP BY coalesce(c.merged_into_id,c.id))`;
  const params = [JSON.stringify(keys), excludeId];
  const { rows } = await db.query(
    `${cte} SELECT page.*,totals.match_total
     FROM (SELECT count(*)::text match_total FROM matched) totals
     LEFT JOIN LATERAL (
     SELECT c.*,m.email matched_email,m.phone matched_phone,
     portal_private.candidate_group_blocked(c.id) blocked,
     (SELECT count(*) FROM portal.applications a WHERE a.candidate_id=c.id AND a.intake_state='CONFIRMED') application_count
     FROM matched m JOIN portal.candidates c ON c.id=m.id
     ORDER BY (m.email AND m.phone) DESC,c.id LIMIT $3 OFFSET $4
     ) page ON true ORDER BY (page.matched_email AND page.matched_phone) DESC,page.id`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  const total = Number(rows[0]?.match_total ?? 0);
  return {
    matches: rows
      .filter((row) => row.id !== null)
      .map((row) => ({
        candidate: candidateDto(row),
        reason:
          row.matched_email && row.matched_phone
            ? "both"
            : row.matched_email
              ? "email"
              : "phone",
        conflict: total > 1 || !(row.matched_email && row.matched_phone),
      })),
    total,
    page,
    pageSize,
    reviewRequired: true,
  };
}
export function readMatches(
  identity: StaffIdentity,
  id: string,
  query: unknown = {},
) {
  const input = pagination.strict().parse(query);
  return staffRead(identity, rolesFor("applications.read"), (db) =>
    selectMatches(db, z.uuid().parse(id), input.page, input.pageSize),
  );
}
export function mergeCandidates(
  identity: StaffIdentity,
  id: string,
  body: unknown,
) {
  const input = mergeCommand.parse(body);
  return staffRead(identity, rolesFor("applications.write"), async (db) => {
    const target = await selectCandidate(db, z.uuid().parse(id)),
      source = await selectCandidate(db, input.sourceId);
    // SQL checks alias/version conflicts after replay lookup, so a committed
    // request can still be replayed after a later merge changed the canonical ID.
    if (id === input.sourceId) throw new RecruitmentError(409);
    if (
      !candidateDto(target).mergeAllowed ||
      !candidateDto(source).mergeAllowed
    )
      throw new RecruitmentError(409);
    const { rows } = await db.query(
      "SELECT portal_private.manage_recruitment('merge',$1,$2,$3,NULL,$4,$5) result",
      [
        id,
        input.expectedVersion,
        input.requestId,
        input.sourceId,
        input.sourceVersion,
      ],
    );
    return {
      result: rows[0].result,
      candidate: candidateDto(await selectCandidate(db, id)),
    };
  });
}
