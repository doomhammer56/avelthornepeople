import "server-only";
import { z } from "zod";
import { StaffAuthError } from "../auth/errors.ts";
export class RecruitmentError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("Recruitment request failed");
    this.status = status;
  }
}
export function recruitmentError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (error instanceof RecruitmentError || error instanceof StaffAuthError)
    return error.status;
  if (error instanceof z.ZodError || ["22023", "22P02", "23514"].includes(code))
    return 400;
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (["40001", "23505", "55000"].includes(code)) return 409;
  return 503;
}
