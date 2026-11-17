import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLEAN_BUCKET,
  CV_MIME_TYPES,
  CvStorageError,
  MAX_CV_BYTES,
  QUARANTINE_BUCKET,
} from "./config.ts";

// Provision through the Storage API. Never create/delete storage.objects rows.
export async function configureCvBuckets(
  client: SupabaseClient,
  apply = false,
) {
  const result = [];
  for (const name of [QUARANTINE_BUCKET, CLEAN_BUCKET]) {
    const existing = await client.storage.getBucket(name);
    if (existing.error && String(existing.error.statusCode) !== "404") {
      throw new CvStorageError("PROVIDER");
    }
    const settings = {
      public: false,
      fileSizeLimit: MAX_CV_BYTES,
      allowedMimeTypes: [...CV_MIME_TYPES],
    };
    const matches =
      existing.data?.public === false &&
      Number(existing.data.file_size_limit) === MAX_CV_BYTES &&
      JSON.stringify([...(existing.data.allowed_mime_types ?? [])].sort()) ===
        JSON.stringify([...CV_MIME_TYPES].sort());
    if (!matches && apply) {
      const changed = existing.data
        ? await client.storage.updateBucket(name, settings)
        : await client.storage.createBucket(name, settings);
      if (changed.error) throw new CvStorageError("PROVIDER");
      const verified = await client.storage.getBucket(name);
      if (
        verified.error ||
        verified.data?.public !== false ||
        Number(verified.data.file_size_limit) !== MAX_CV_BYTES ||
        JSON.stringify([...(verified.data.allowed_mime_types ?? [])].sort()) !==
          JSON.stringify([...CV_MIME_TYPES].sort())
      )
        throw new CvStorageError("PROVIDER");
    }
    result.push({
      bucket: name,
      configured: matches || apply,
      changed: !matches && apply,
    });
  }
  return result;
}
