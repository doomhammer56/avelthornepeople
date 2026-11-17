import "server-only";
import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { staffEndpoint } from "../auth/middleware.ts";
import {
  authErrorResponse,
  StaffAuthError,
  privateHeaders,
} from "../auth/errors.ts";
import type { StaffIdentity } from "../auth/identity.ts";
import { mapJobError } from "./management.ts";
import { JobValidationError } from "./validation.ts";

export class JobNotFound extends Error {}
export async function jobEndpoint(
  request: NextRequest,
  mutate: boolean,
  action: (identity: StaffIdentity) => Promise<unknown>,
  status = 200,
) {
  return staffEndpoint(
    request,
    mutate ? "jobs.write" : "jobs.read",
    async (identity) => {
      const result = await action(identity);
      // Published listings are cached for visitors. Drop that cache on every write.
      if (mutate) revalidateTag("public-jobs", { expire: 0 });
      return result;
    },
    {
      write: mutate,
      status,
      errorResponse: jobErrorResponse,
    },
  );
}
export function jobErrorResponse(error: unknown) {
  const mapped = mapJobError(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  return error instanceof JobNotFound || code === "P0002"
    ? Response.json(
        { error: "Job not found" },
        { status: 404, headers: privateHeaders },
      )
    : mapped instanceof JobValidationError
      ? Response.json(
          { error: "validation_failed", issues: mapped.issues },
          { status: 400, headers: privateHeaders },
        )
      : authErrorResponse(mapped);
}
export async function jobBody(request: Request, limit = 230000) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new StaffAuthError(400);
  const reader = request.body?.getReader();
  if (!reader) throw new StaffAuthError(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StaffAuthError(400);
  }
}
