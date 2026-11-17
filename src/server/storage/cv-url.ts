import "server-only";
import { randomUUID } from "node:crypto";
import type { CleanCv, CvStorage } from "../adapters/storage/cv-storage.ts";
import { UUID } from "../adapters/storage/cv-storage.ts";
import { CvStorageError } from "../adapters/storage/config.ts";
import { StaffAuthError } from "../auth/errors.ts";
import { can } from "../../lib/auth/permissions.ts";

export class CvAccessError extends Error {
  readonly status: number;
  constructor(status: 400 | 401 | 403 | 404 | 503) {
    super(status === 503 ? "CV service unavailable" : "CV access denied");
    this.status = status;
  }
}

export interface CvSession {
  role(): Promise<string | null>;
  findCv(applicationId: string): Promise<CleanCv | null>;
  recordAccess(
    applicationId: string,
    requestId: string,
    expected: CleanCv,
  ): Promise<void>;
}
export interface CvRepository {
  withSubject<T>(
    subject: string,
    action: (session: CvSession) => Promise<T>,
  ): Promise<T>;
}

export async function issueCvDownloadUrl(
  input: { applicationId: string; token: string; mode: "preview" | "download" },
  dependencies: {
    verifyUser: (token: string) => Promise<string | null>;
    repository: CvRepository;
    storage: CvStorage;
  },
) {
  if (
    !UUID.test(input.applicationId) ||
    !["preview", "download"].includes(input.mode)
  )
    throw new CvAccessError(400);
  if (!input.token || input.token.length > 16_384) throw new CvAccessError(401);
  const subject = await dependencies.verifyUser(input.token);
  if (!subject || !UUID.test(subject)) throw new CvAccessError(401);
  const cv = await dependencies.repository.withSubject(
    subject,
    async (session) => {
      if (!can(await session.role(), "cv.read")) throw new CvAccessError(403);
      const cv = await session.findCv(input.applicationId);
      if (!cv) throw new CvAccessError(404);
      return cv;
    },
  );
  const signed = await dependencies.storage.signDownload(cv, input.mode);
  // Recheck authorization and the exact signed descriptor in a new, short
  // transaction. Neither Storage HTTP request occupies a database connection.
  await dependencies.repository.withSubject(subject, async (session) => {
    if (!can(await session.role(), "cv.read")) throw new CvAccessError(403);
    await session.recordAccess(input.applicationId, randomUUID(), cv);
  });
  return signed;
}

export function cvErrorResponse(error: unknown) {
  const status =
    error instanceof CvAccessError || error instanceof StaffAuthError
      ? error.status
      : error instanceof CvStorageError && error.code === "INVALID_FILE"
        ? 404
        : 503;
  return Response.json(
    { error: status === 503 ? "CV service unavailable" : "CV access denied" },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}
