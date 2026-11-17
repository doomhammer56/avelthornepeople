import { createCvStorage } from "@/server/adapters/storage/cv-storage";
import { storageAdminClient } from "@/server/adapters/storage/config";
import {
  CvAccessError,
  cvErrorResponse,
  issueCvDownloadUrl,
} from "@/server/storage/cv-url";
import { cvRepository } from "@/server/storage/repository";
import type { NextRequest } from "next/server";
import { staffEndpoint } from "@/server/auth/middleware";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ applicationId: string }> },
) {
  return staffEndpoint(
    request,
    "cv.read",
    async (identity) => {
      const mode = new URL(request.url).searchParams.get("mode") ?? "download";
      if (mode !== "preview" && mode !== "download")
        throw new CvAccessError(400);
      const { applicationId } = await context.params;
      const client = storageAdminClient();
      const result = await issueCvDownloadUrl(
        { applicationId, token: identity.token, mode },
        {
          verifyUser: async () => identity.subject,
          repository: cvRepository(identity.sessionId),
          storage: createCvStorage(client),
        },
      );
      return result;
    },
    { write: true, errorResponse: cvErrorResponse },
  );
}
