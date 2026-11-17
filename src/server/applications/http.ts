import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { staffEndpoint } from "../auth/middleware.ts";
import type { StaffIdentity } from "../auth/identity.ts";
import { privateHeaders } from "../auth/errors.ts";
import { RecruitmentError, recruitmentError } from "./errors.ts";
export { RecruitmentError } from "./errors.ts";
export async function recruitmentEndpoint(
  request: NextRequest,
  mutate: boolean,
  action: (identity: StaffIdentity) => Promise<unknown>,
) {
  return staffEndpoint(
    request,
    mutate ? "applications.write" : "applications.read",
    action,
    { write: mutate, errorResponse: recruitmentErrorResponse },
  );
}
export function recruitmentErrorResponse(error: unknown) {
  const status = recruitmentError(error);
  const issues =
    error instanceof z.ZodError
      ? error.issues.slice(0, 10).map((i) => ({
          field: [
            "status",
            "email",
            "phone",
            "region",
            "from",
            "to",
            "sourceId",
            "expectedVersion",
            "sourceVersion",
            "page",
            "pageSize",
          ].includes(String(i.path[0]))
            ? String(i.path[0])
            : "request",
          code: "invalid",
        }))
      : undefined;
  const response = NextResponse.json(
    {
      error:
        status === 503
          ? "Recruitment service unavailable"
          : status === 400
            ? "validation_failed"
            : "Request not permitted",
      ...(issues ? { issues } : {}),
    },
    { status, headers: privateHeaders },
  );
  return response;
}
export async function recruitmentBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new RecruitmentError(400);
  const reader = request.body?.getReader();
  if (!reader) throw new RecruitmentError(400);
  try {
    let size = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8000) {
        await reader.cancel();
        throw new Error();
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RecruitmentError(400);
  }
}
