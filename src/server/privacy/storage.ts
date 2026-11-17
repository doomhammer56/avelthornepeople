import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UUID, validateObjectKey } from "../adapters/storage/cv-storage.ts";
import {
  CLEAN_BUCKET,
  QUARANTINE_BUCKET,
  CvStorageError,
} from "../adapters/storage/config.ts";

export function createPrivacyStorage(client: SupabaseClient) {
  return {
    async purgeUpload(
      uploadId: string,
      provider: string,
      descriptor: { bucket: string; objectKey: string },
    ) {
      if (
        !UUID.test(uploadId) ||
        provider !== "SUPABASE" ||
        !descriptor ||
        ![CLEAN_BUCKET, QUARANTINE_BUCKET].includes(descriptor.bucket)
      )
        throw new CvStorageError("UNAVAILABLE");
      validateObjectKey(descriptor.objectKey, uploadId);
      if (!descriptor.objectKey.startsWith(`${uploadId}/`))
        throw new CvStorageError("UNAVAILABLE");
      const started = Date.now();
      const budget = () => {
        if (Date.now() - started >= 20_000)
          throw new CvStorageError("UNAVAILABLE");
      };
      // Promotion creates a DIFFERENT immutable key. Enumerate both exact UUID
      // prefixes so an old quarantine original cannot survive a clean-CV erase.
      for (const bucket of [QUARANTINE_BUCKET, CLEAN_BUCKET]) {
        const storage = client.storage.from(bucket);
        const keys: string[] = [];
        let complete = false;
        for (let page = 0; page < 10; page++) {
          budget();
          const result = await storage.list(uploadId, {
            limit: 100,
            offset: page * 100,
            sortBy: { column: "name", order: "asc" },
          });
          if (result.error || !result.data)
            throw new CvStorageError("PROVIDER");
          for (const object of result.data) {
            const key = `${uploadId}/${object.name}`;
            validateObjectKey(key, uploadId);
            keys.push(key);
          }
          if (result.data.length < 100) {
            complete = true;
            break;
          }
        }
        if (!complete) throw new CvStorageError("UNAVAILABLE");
        for (let offset = 0; offset < keys.length; offset += 100) {
          budget();
          if ((await storage.remove(keys.slice(offset, offset + 100))).error)
            throw new CvStorageError("PROVIDER");
        }
        budget();
        const remaining = await storage.list(uploadId, { limit: 1, offset: 0 });
        if (remaining.error || !remaining.data || remaining.data.length)
          throw new CvStorageError("PROVIDER");
      }
    },
  };
}
