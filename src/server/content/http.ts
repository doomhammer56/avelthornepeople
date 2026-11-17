import "server-only";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { staffEndpoint } from "../auth/middleware.ts";
import type { StaffIdentity } from "../auth/identity.ts";
import { privateHeaders, StaffAuthError } from "../auth/errors.ts";
import { ContentError } from "./errors.ts";
export function contentErrorResponse(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  const status =
    error instanceof ContentError || error instanceof StaffAuthError
      ? error.status
      : error instanceof z.ZodError ||
          ["22023", "22P02", "23514"].includes(code)
        ? 400
        : code === "42501"
          ? 403
          : code === "P0002"
            ? 404
            : ["40001", "23505", "55000"].includes(code)
              ? 409
              : 503;
  const issues =
    error instanceof ContentError
      ? error.issues
      : error instanceof z.ZodError
        ? error.issues.slice(0, 20).map((i) => ({
            field: i.path
              .map((p) => String(p))
              .filter((p) => /^[a-zA-Z0-9_]+$/.test(p))
              .slice(0, 5)
              .join("."),
            code: "invalid",
          }))
        : [];
  return NextResponse.json(
    {
      error:
        status === 400
          ? "validation_failed"
          : status === 503
            ? "Content service unavailable"
            : "Request not permitted",
      ...(status === 400 ? { issues } : {}),
    },
    { status, headers: privateHeaders },
  );
}
export function contentEndpoint(
  request: NextRequest,
  write: boolean,
  action: (identity: StaffIdentity) => Promise<unknown>,
) {
  return staffEndpoint(
    request,
    write ? "content.write" : "content.read",
    async (identity) => {
      const result = await action(identity);
      if (write) revalidateTag("company-content", { expire: 0 });
      return result;
    },
    { write, errorResponse: contentErrorResponse },
  );
}
export async function boundedBody(request: Request, max: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new ContentError(400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new ContentError(413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function contentBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new ContentError(400);
  const value = await boundedBody(request, 250000);
  try {
    return JSON.parse(value.toString("utf8"));
  } catch {
    throw new ContentError(400);
  }
}
