import { rolesFor } from "../../lib/auth/permissions.ts";
import "server-only";
import type pg from "pg";
import { z } from "zod";
import { staffRead } from "../admin/read.ts";
import type { StaffIdentity } from "../auth/identity.ts";
import { withPublicReader } from "../database/public.ts";
import {
  contentDraft,
  contentTypes,
  contentIssues,
  imageIds,
  createContent,
  saveContent,
  contentAction,
  type ContentType,
  type ManagedContentBlock,
  type ContentImage,
  type PublicContentBlock,
} from "../../lib/content/contract.ts";
import { ContentError } from "./errors.ts";
const roles = rolesFor("content.read");
function snapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContentError(503);
  const { englishFallback, ...draft } = value as Record<string, unknown>;
  return {
    draft: contentDraft.parse(draft),
    fallback: englishFallback === true,
  };
}
async function imageMap(
  db: pg.PoolClient,
  ids: string[],
  publicRead = false,
): Promise<Record<string, ContentImage>> {
  if (!ids.length) return {};
  const { rows } = await db.query(
    `SELECT id,width,height FROM portal.${publicRead ? "published_content_images" : "content_images"} WHERE id=ANY($1::uuid[])`,
    [ids],
  );
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        width: Number(row.width),
        height: Number(row.height),
        url: `/api/${publicRead ? "content" : "admin/content"}/images/${row.id}`,
      },
    ]),
  );
}
async function selectBlocks(
  db: pg.PoolClient,
  id?: string,
): Promise<ManagedContentBlock[]> {
  const { rows } = await db.query(
    "SELECT id,type,slot,sort_order,draft_content,published_content,published_sort_order,published_version,published_at,version,updated_at FROM portal.content_blocks WHERE slot IS NOT NULL AND ($1::uuid IS NULL OR id=$1) ORDER BY sort_order,id",
    [id ?? null],
  );
  const drafts = rows.map((row) => contentDraft.parse(row.draft_content));
  const images = await imageMap(db, [...new Set(drafts.flatMap(imageIds))]);
  return rows.map((row, i) => {
    const published = row.published_content
      ? snapshot(row.published_content)
      : null;
    return {
      id: String(row.id),
      type: z.enum(contentTypes).parse(row.type),
      sortOrder: Number(row.sort_order),
      version: Number(row.version),
      publishedVersion:
        row.published_version === null ? null : Number(row.published_version),
      publishedAt: row.published_at
        ? new Date(row.published_at).toISOString()
        : null,
      updatedAt: new Date(row.updated_at).toISOString(),
      state: !published
        ? "draft"
        : row.sort_order !== row.published_sort_order ||
            JSON.stringify(published.draft) !== JSON.stringify(drafts[i])
          ? "unpublished"
          : "published",
      approvedChineseFallback: published?.fallback ?? false,
      draft: drafts[i],
      images,
    };
  });
}
export function readContent(identity: StaffIdentity, id?: string) {
  if (id) z.uuid().parse(id);
  return staffRead(identity, roles, async (db) => {
    const blocks = await selectBlocks(db, id);
    if (id && !blocks.length) throw new ContentError(404);
    return { blocks };
  });
}
export function manageContent(
  identity: StaffIdentity,
  kind: "create" | "save" | "action",
  id: string | undefined,
  body: unknown,
) {
  const input =
    kind === "create"
      ? createContent.parse(body)
      : kind === "save"
        ? saveContent.parse(body)
        : contentAction.parse(body);
  const target = "id" in input ? input.id : z.uuid().parse(id);
  return staffRead(identity, rolesFor("content.write"), async (db) => {
    const existing =
      kind === "create" ? null : (await selectBlocks(db, target))[0];
    if (kind !== "create" && !existing) throw new ContentError(404);
    const type = "type" in input ? input.type : existing!.type,
      draft = "draft" in input ? input.draft : existing!.draft,
      action = "action" in input ? input.action : kind;
    const fallback =
      "allowChineseFallback" in input ? input.allowChineseFallback : false;
    if (
      action !== "unpublish" &&
      (action !== "publish" ||
        existing?.version ===
          ("expectedVersion" in input ? input.expectedVersion : null))
    ) {
      const issues = contentIssues(type, draft, action === "publish", fallback);
      if (issues.length) throw new ContentError(400, issues);
    }
    const { rows } = await db.query(
      "SELECT portal_private.manage_content($1,$2,$3,$4,$5,$6,$7,$8) result",
      [
        action,
        target,
        "expectedVersion" in input ? input.expectedVersion : null,
        input.requestId,
        kind === "create" ? type : null,
        "draft" in input ? JSON.stringify(draft) : null,
        "sortOrder" in input ? input.sortOrder : null,
        fallback,
      ],
    );
    return {
      result: rows[0].result,
      block: (await selectBlocks(db, target))[0],
    };
  });
}
export async function publishedContent(
  locale: "en" | "zh",
  type?: ContentType,
): Promise<PublicContentBlock[]> {
  return withPublicReader(async (db) => {
    const { rows } = await db.query(
      "SELECT id,type,sort_order,version,published_content FROM portal.company_content WHERE ($1::text IS NULL OR type=$1) ORDER BY sort_order,id",
      [type ?? null],
    );
    const published = rows.map((row) => snapshot(row.published_content)),
      images = await imageMap(
        db,
        [...new Set(published.flatMap((p) => imageIds(p.draft)))],
        true,
      );
    return rows.map((row, index) => {
      const { draft, fallback } = published[index],
        language = locale === "en" && fallback ? "zh" : locale;
      const missing = imageIds(draft).some((id) => !images[id]);
      if (missing || contentIssues(row.type, draft, true, fallback).length)
        throw new ContentError(503);
      return {
        id: String(row.id),
        type: z.enum(contentTypes).parse(row.type),
        sortOrder: Number(row.sort_order),
        version: Number(row.version),
        locale: language,
        englishFallback: locale === "en" && fallback,
        text: draft[language],
        image: draft.imageId ? images[draft.imageId] : null,
        items: draft.items.map((item) => ({
          id: item.id,
          kind: item.kind,
          text: item[language],
          image: item.imageId ? images[item.imageId] : null,
          locationFilter: item.locationFilter,
        })),
      };
    });
  });
}
