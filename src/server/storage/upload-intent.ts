import "server-only";
import { createHash, randomBytes } from "node:crypto";
import {
  prepareUpload,
  type CvStorage,
  type UploadIntent,
} from "../adapters/storage/cv-storage.ts";
import {
  CvStorageError,
  PROVIDER_UPLOAD_SECONDS,
} from "../adapters/storage/config.ts";

export interface IntentRepository {
  reserve(
    input: UploadIntent & { capabilityHash: Buffer; providerExpiresAt: Date },
  ): Promise<void>;
  recordProviderExpiry(id: string, expiresAt: Date): Promise<void>;
}

// This is a trusted service boundary, not a public endpoint. The caller must
// enforce CAPTCHA, distributed rate/quota limits and current job eligibility.
// M3 intake must claim the hashed capability transactionally before accepting
// the submission, enforce acceptBefore, and verify consent/idempotency.
export async function issueCvUploadIntent(
  input: { contentType: string; sizeBytes: number },
  dependencies: {
    guard: () => Promise<void>;
    repository: IntentRepository;
    storage: CvStorage;
  },
) {
  const intent = prepareUpload(input.contentType, input.sizeBytes);
  await dependencies.guard();
  const capability = randomBytes(32).toString("base64url");
  // Reserve a conservative transport deadline before minting a provider token.
  // If recording its exact expiry fails, no token is returned to the caller.
  await dependencies.repository.reserve({
    ...intent,
    capabilityHash: createHash("sha256").update(capability).digest(),
    providerExpiresAt: new Date(
      Date.now() + (PROVIDER_UPLOAD_SECONDS + 300) * 1000,
    ),
  });
  const ticket = await dependencies.storage.issueUpload(intent);
  await dependencies.repository.recordProviderExpiry(
    intent.id,
    ticket.providerExpiresAt,
  );
  if (intent.acceptBefore.getTime() <= Date.now())
    throw new CvStorageError("UNAVAILABLE");
  return {
    uploadId: intent.id,
    capability,
    path: ticket.path,
    token: ticket.token,
    signedUrl: ticket.signedUrl,
    providerExpiresAt: ticket.providerExpiresAt.toISOString(),
    acceptBefore: intent.acceptBefore.toISOString(),
  };
}
