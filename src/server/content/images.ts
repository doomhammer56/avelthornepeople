import { rolesFor } from "../../lib/auth/permissions.ts";
import "server-only";
import sharp from "sharp";
import { randomUUID, createHash } from "node:crypto";
import { storageAdminClient } from "../adapters/storage/config.ts";
import { staffRead } from "../admin/read.ts";
import type { StaffIdentity } from "../auth/identity.ts";
import { withPublicReader } from "../database/public.ts";
import { ContentError } from "./errors.ts";
import { z } from "zod";
export const CONTENT_BUCKET = "company-content",
  MAX_IMAGE_BYTES = 3_000_000;
export async function canonicalImage(input: Buffer, mime: string) {
  try {
    if (!input.length || input.length > MAX_IMAGE_BYTES) throw new Error();
    const allowed: Record<string, string> = {
      "image/jpeg": "jpeg",
      "image/png": "png",
      "image/webp": "webp",
    };
    if (!allowed[mime]) throw new Error();
    const signature =
      mime === "image/jpeg"
        ? input.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        : mime === "image/png"
          ? input
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : input.toString("ascii", 0, 4) === "RIFF" &&
            input.toString("ascii", 8, 12) === "WEBP";
    if (!signature) throw new Error();
    if (mime === "image/png") {
      for (let offset = 8; offset + 12 <= input.length;) {
        const size = input.readUInt32BE(offset);
        if (size > input.length - offset - 12) throw new Error();
        if (input.toString("ascii", offset + 4, offset + 8) === "acTL")
          throw new Error();
        offset += size + 12;
      }
    }
    const pipeline = sharp(input, {
        limitInputPixels: 20_000_000,
        failOn: "warning",
      }),
      metadata = await pipeline.metadata();
    if (
      metadata.format !== allowed[mime] ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > 20_000_000
    )
      throw new Error();
    const { data, info } = await pipeline
      .autoOrient()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES) throw new Error();
    return {
      data,
      width: info.width,
      height: info.height,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  } catch {
    throw new ContentError(400, [{ field: "image", code: "invalid" }]);
  }
}
export async function uploadContentImage(
  identity: StaffIdentity,
  body: () => Promise<Buffer>,
  mime: string,
) {
  // Authenticate/authorize before reading or decoding untrusted binary input.
  await staffRead(identity, rolesFor("content.write"), async () => {});
  const image = await canonicalImage(await body(), mime),
    id = randomUUID(),
    key = `images/${id}.webp`,
    storage = storageAdminClient();
  const uploaded = await storage.storage
    .from(CONTENT_BUCKET)
    .upload(key, image.data, {
      contentType: "image/webp",
      upsert: false,
      cacheControl: "60",
    });
  if (uploaded.error) throw new ContentError(503);
  try {
    return await staffRead(identity, rolesFor("content.write"), async (db) => {
      await db.query(
        "SELECT portal_private.register_content_image($1,$2,$3,$4,$5,$6)",
        [id, key, image.width, image.height, image.data.length, image.sha256],
      );
      return {
        image: {
          id,
          width: image.width,
          height: image.height,
          url: `/api/admin/content/images/${id}`,
        },
      };
    });
  } catch (error) {
    await storage.storage
      .from(CONTENT_BUCKET)
      .remove([key])
      .catch(() => {});
    throw error;
  }
}
export async function contentImageResponse(
  id: string,
  identity?: StaffIdentity,
) {
  z.uuid().parse(id);
  const read = async (db: {
    query: (
      sql: string,
      values: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[] }>;
  }) =>
    (
      await db.query(
        identity
          ? "SELECT object_key FROM portal.content_images WHERE id=$1"
          : "SELECT object_key FROM portal.published_content_images WHERE id=$1",
        [id],
      )
    ).rows[0];
  const row = identity
    ? await staffRead(identity, rolesFor("content.read"), read)
    : await withPublicReader(read);
  if (!row || row.object_key !== `images/${id.toLowerCase()}.webp`)
    throw new ContentError(404);
  const result = await storageAdminClient()
    .storage.from(CONTENT_BUCKET)
    .download(String(row.object_key));
  if (result.error) throw new ContentError(503);
  return new Response(await result.data.arrayBuffer(), {
    headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": identity ? "private, no-store" : "public, max-age=60",
      "Content-Security-Policy": "default-src 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}
