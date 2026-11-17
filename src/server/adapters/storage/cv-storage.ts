import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICATION_TICKET_SECONDS,
  CLEAN_BUCKET,
  CV_MIME_TYPES,
  CvStorageError,
  DOWNLOAD_TTL_SECONDS,
  MAX_CV_BYTES,
  ORPHAN_GRACE_SECONDS,
  PROVIDER_UPLOAD_SECONDS,
  QUARANTINE_BUCKET,
} from "./config.ts";

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|doc)$/i;
export type CvMime = (typeof CV_MIME_TYPES)[number];

export function validateFile(
  contentType: string,
  size: number,
): asserts contentType is CvMime {
  if (
    !(CV_MIME_TYPES as readonly string[]).includes(contentType) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_CV_BYTES
  ) {
    throw new CvStorageError("INVALID_FILE");
  }
}

export function validateObjectKey(key: string, uploadId: string) {
  const parts = key.split("/");
  if (
    !UUID.test(uploadId) ||
    !KEY.test(key) ||
    parts[0].toLowerCase() !== uploadId.toLowerCase() ||
    !UUID.test(parts[1]?.split(".")[0] ?? "")
  )
    throw new CvStorageError("INVALID_FILE");
}

export function prepareUpload(
  contentType: string,
  sizeBytes: number,
  now = new Date(),
) {
  validateFile(contentType, sizeBytes);
  const id = randomUUID();
  return {
    id,
    contentType,
    sizeBytes,
    objectKey: `${id}/${randomUUID()}.${contentType === "application/pdf" ? "pdf" : "doc"}`,
    acceptBefore: new Date(now.getTime() + APPLICATION_TICKET_SECONDS * 1000),
  };
}

export type UploadIntent = ReturnType<typeof prepareUpload>;
export type CleanCv = {
  id: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: Uint8Array;
  scanState?: "CLEAN" | "UNSCANNED";
};
type ExpiredQuarantine = {
  id: string;
  objectKey: string;
  providerExpiresAt: Date;
};

function provider<T>(result: { data: T | null; error: unknown }): T {
  if (result.error || result.data === null)
    throw new CvStorageError("PROVIDER");
  return result.data;
}

export function createCvStorage(client: SupabaseClient) {
  const removeExpiredQuarantines = async (intents: ExpiredQuarantine[]) => {
    if (!intents.length) return;
    if (intents.length > 20) throw new CvStorageError("INVALID_FILE");
    for (const intent of intents) {
      validateObjectKey(intent.objectKey, intent.id);
      const deadline = intent.providerExpiresAt.getTime();
      if (
        !Number.isFinite(deadline) ||
        Date.now() < deadline + ORPHAN_GRACE_SECONDS * 1000
      )
        throw new CvStorageError("UNAVAILABLE");
    }
    provider(
      await client.storage
        .from(QUARANTINE_BUCKET)
        .remove(intents.map((intent) => intent.objectKey)),
    );
  };
  return {
    removeExpiredQuarantines,
    removeExpiredQuarantine: (intent: ExpiredQuarantine) =>
      removeExpiredQuarantines([intent]),

    async issueUpload(intent: UploadIntent) {
      validateFile(intent.contentType, intent.sizeBytes);
      validateObjectKey(intent.objectKey, intent.id);
      if (intent.acceptBefore.getTime() <= Date.now())
        throw new CvStorageError("UNAVAILABLE");
      const issuedAt = Date.now();
      const result = provider(
        await client.storage
          .from(QUARANTINE_BUCKET)
          .createSignedUploadUrl(intent.objectKey, { upsert: false }),
      );
      // This token is from the trusted provider response, never request input.
      // Read its expiry for cleanup bookkeeping, not as identity/role authority.
      let expires: number;
      try {
        expires = JSON.parse(
          Buffer.from(result.token.split(".")[1], "base64url").toString(),
        ).exp;
      } catch {
        throw new CvStorageError("PROVIDER");
      }
      if (
        !Number.isSafeInteger(expires) ||
        expires * 1000 <= issuedAt ||
        expires * 1000 > issuedAt + (PROVIDER_UPLOAD_SECONDS + 300) * 1000
      ) {
        throw new CvStorageError("PROVIDER");
      }
      return {
        token: result.token,
        path: intent.objectKey,
        signedUrl: result.signedUrl,
        providerExpiresAt: new Date(expires * 1000),
      };
    },

    async signDownload(cv: CleanCv, mode: "preview" | "download" = "download") {
      validateFile(cv.contentType, cv.sizeBytes);
      validateObjectKey(cv.objectKey, cv.id);
      if (
        cv.sha256.byteLength !== 32 ||
        !cv.objectKey.endsWith(
          cv.contentType === "application/pdf" ? ".pdf" : ".doc",
        )
      ) {
        throw new CvStorageError("UNAVAILABLE");
      }
      const unscanned = cv.scanState === "UNSCANNED";
      const bucket = client.storage.from(
        unscanned ? QUARANTINE_BUCKET : CLEAN_BUCKET,
      );
      const metadata = provider(await bucket.info(cv.objectKey));
      if (
        metadata.size !== cv.sizeBytes ||
        metadata.contentType !== cv.contentType
      ) {
        throw new CvStorageError("UNAVAILABLE");
      }
      const download =
        mode === "download" || cv.contentType === "application/msword";
      const issuedAt = Date.now();
      const signed = provider(
        await bucket.createSignedUrl(cv.objectKey, DOWNLOAD_TTL_SECONDS, {
          ...(download
            ? {
                download:
                  cv.contentType === "application/pdf" ? "cv.pdf" : "cv.doc",
              }
            : {}),
        }),
      );
      return {
        url: signed.signedUrl,
        expiresAt: new Date(
          issuedAt + DOWNLOAD_TTL_SECONDS * 1000,
        ).toISOString(),
        disposition: download ? ("attachment" as const) : ("inline" as const),
      };
    },

    // Call only from the trusted scanner/finalizer, outside a web file-upload route.
    // The scanner must have inspected these exact bytes; caller cannot mark a CV clean.
    async promoteVerified(cv: CleanCv) {
      validateFile(cv.contentType, cv.sizeBytes);
      validateObjectKey(cv.objectKey, cv.id);
      const source = client.storage.from(QUARANTINE_BUCKET);
      const metadata = provider(await source.info(cv.objectKey));
      if (
        metadata.size !== cv.sizeBytes ||
        metadata.contentType !== cv.contentType
      ) {
        throw new CvStorageError("UNAVAILABLE");
      }
      const blob = provider(await source.download(cv.objectKey));
      if (blob.size !== cv.sizeBytes) throw new CvStorageError("UNAVAILABLE");
      const bytes = Buffer.from(await blob.arrayBuffer());
      const digest = createHash("sha256").update(bytes).digest();
      if (cv.sha256.byteLength !== 32 || !timingSafeEqual(digest, cv.sha256)) {
        throw new CvStorageError("UNAVAILABLE");
      }
      const objectKey = `${cv.id}/${randomUUID()}.${cv.contentType === "application/pdf" ? "pdf" : "doc"}`;
      provider(
        await client.storage.from(CLEAN_BUCKET).upload(objectKey, bytes, {
          contentType: cv.contentType,
          cacheControl: "0",
          upsert: false,
        }),
      );
      return {
        storageProvider: "SUPABASE" as const,
        bucket: CLEAN_BUCKET,
        objectKey,
        sha256: digest,
        sizeBytes: bytes.length,
      };
    },
  };
}

export type CvStorage = ReturnType<typeof createCvStorage>;
