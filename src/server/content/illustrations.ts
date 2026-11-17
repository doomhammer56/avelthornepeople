import "server-only";
import { illustrationObjectKey } from "../../lib/content/illustrations.ts";
import { storageAdminClient } from "../adapters/storage/config.ts";
import { ContentError } from "./errors.ts";
import { CONTENT_BUCKET } from "./images.ts";

export async function companyIllustrationResponse(
  name: string,
  storage = storageAdminClient,
) {
  // Only these six already-public defaults may bypass draft publication checks.
  const key = illustrationObjectKey(name);
  if (!key) throw new ContentError(404);
  const result = await storage().storage.from(CONTENT_BUCKET).download(key);
  if (result.error) throw new ContentError(503);
  return new Response(result.data, {
    headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
      "Content-Security-Policy": "default-src 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}
