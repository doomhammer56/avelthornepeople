import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { contentDraft, contentIssues } from "../../src/lib/content/contract.ts";
import { contentTemplates } from "./templates.ts";

// Operator-only bootstrap. The caller owns the transaction; HTTP handlers never
// import this module or use its connection. Published/editor-managed rows survive.
// Markers of the pre-redesign demo seed. Used only to label dry-run output.
const legacyPattern = /northline|北线|standardised|标准化运营/i;
const hasImages = (draft) =>
  !!draft?.imageId || (draft?.items ?? []).some((item) => item.imageId);

// `replace` lists block types an operator explicitly asked to rewrite with the
// current starter copy. Blocks holding uploaded images are never rewritten.
export async function seedCompanyContent(
  db,
  { adminId, apply = false, replace = [] } = {},
) {
  const replaceTypes = new Set(replace);
  const admins = await db.query(
    "SELECT id FROM portal.staff_profiles WHERE active AND role='ADMIN' AND ($1::uuid IS NULL OR id=$1) FOR SHARE",
    [adminId ?? null],
  );
  if (admins.rows.length !== 1)
    throw new Error(
      "Specify --admin-id for one active ADMIN in this database.",
    );
  const actor = admins.rows[0].id;
  await db.query("SELECT pg_advisory_xact_lock(7606,67)");
  const results = [];
  for (const template of contentTemplates()) {
    const draft = contentDraft.parse(template.draft);
    if (contentIssues(template.type, draft, true, false).length)
      throw new Error(
        "Starter content does not satisfy publication validation.",
      );
    const current = (
      await db.query(
        "SELECT c.*,EXISTS(SELECT 1 FROM portal.audit_logs a WHERE a.object_id=c.id AND a.object_type='CONTENT' AND a.action='CONTENT_TEMPLATE_CREATED') starter FROM portal.content_blocks c WHERE slot=lower($1) FOR UPDATE",
        [template.type],
      )
    ).rows[0];
    const untouched =
      current?.starter &&
      current.version === 1 &&
      current.published_content === null &&
      current.published_at === null &&
      current.sort_order === template.sortOrder &&
      isDeepStrictEqual(current.draft_content, draft);
    const upToDate =
      !!current &&
      current.published_content !== null &&
      isDeepStrictEqual(current.draft_content, draft) &&
      isDeepStrictEqual(
        { ...current.published_content, englishFallback: undefined },
        { ...draft, englishFallback: undefined },
      );
    const replaceable =
      !!current &&
      !untouched &&
      replaceTypes.has(template.type) &&
      !upToDate &&
      !hasImages(current.draft_content) &&
      !hasImages(current.published_content);
    const action = !current
      ? "create-published"
      : untouched
        ? "publish-starter"
        : replaceable
          ? "replace"
          : replaceTypes.has(template.type) && upToDate
            ? "up-to-date"
            : replaceTypes.has(template.type) &&
                (hasImages(current.draft_content) ||
                  hasImages(current.published_content))
              ? "preserve-has-images"
              : "preserve";
    results.push({
      type: template.type,
      action,
      legacy:
        !!current &&
        legacyPattern.test(
          JSON.stringify([current.draft_content, current.published_content]),
        ),
    });
    if (!apply || !["create-published", "publish-starter", "replace"].includes(action)) continue;
    const id = current?.id ?? randomUUID();
    const version = current ? current.version + 1 : 1;
    const published = JSON.stringify({ ...draft, englishFallback: false });
    if (current) {
      await db.query(
        "UPDATE portal.content_blocks SET draft_content=$5::jsonb,published_content=$2::jsonb,published_by=$3,published_at=statement_timestamp(),published_sort_order=sort_order,published_version=$4,version=$4 WHERE id=$1",
        [id, published, actor, version, JSON.stringify(draft)],
      );
    } else {
      const inserted = await db.query(
        "INSERT INTO portal.content_blocks(id,type,slot,sort_order,draft_content,published_content,published_by,published_at,published_sort_order,published_version,version) VALUES($1,$2,lower($2),$3,$4::jsonb,$5::jsonb,$6,statement_timestamp(),$3,$7,$7) ON CONFLICT(slot) DO NOTHING RETURNING id",
        [
          id,
          template.type,
          template.sortOrder,
          JSON.stringify(draft),
          published,
          actor,
          version,
        ],
      );
      // An editor may have created this slot since the initial read.
      if (!inserted.rowCount) {
        results.at(-1).action = "preserve";
        continue;
      }
    }
    const references = JSON.stringify({ id, version });
    await db.query(
      "INSERT INTO portal.audit_logs(actor_id,object_type,object_id,action,safe_changes,request_id) VALUES($1,'CONTENT',$2,'CONTENT_SEEDED',$3::jsonb,$4)",
      [actor, id, references, randomUUID()],
    );
    await db.query(
      "INSERT INTO portal.outbox_events(event_type,aggregate_id,delivery_key,safe_references) VALUES('CONTENT_SEEDED',$1,$2,$3::jsonb)",
      [id, `content-seed:${id}:${version}`, references],
    );
  }
  return results;
}
