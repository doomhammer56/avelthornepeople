import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ContentError } from "./errors.ts";
import { CONTENT_BUCKET, MAX_IMAGE_BYTES } from "./images.ts";
export async function configureContentBucket(
  client: SupabaseClient,
  apply = false,
) {
  const result = await client.storage.getBucket(CONTENT_BUCKET);
  if (result.error && String(result.error.statusCode) !== "404")
    throw new ContentError(503);
  const matches =
    result.data?.public === false &&
    Number(result.data.file_size_limit) === MAX_IMAGE_BYTES &&
    JSON.stringify(result.data.allowed_mime_types) === '["image/webp"]';
  if (!matches && apply) {
    const options = {
      public: false,
      fileSizeLimit: MAX_IMAGE_BYTES,
      allowedMimeTypes: ["image/webp"],
    };
    const changed = result.data
      ? await client.storage.updateBucket(CONTENT_BUCKET, options)
      : await client.storage.createBucket(CONTENT_BUCKET, options);
    if (changed.error) throw new ContentError(503);
    return configureContentBucket(client, false);
  }
  return { bucket: CONTENT_BUCKET, configured: matches };
}
